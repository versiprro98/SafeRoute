#include <SFML/Graphics.hpp>
#include <vector>
#include <cmath>
#include <limits>
#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <cstdint>

using namespace std;

// --- CONFIGURATION ---
const unsigned int GRID_SIZE = 25;
const unsigned int COLS = 30;
const unsigned int ROWS = 20;
const unsigned int WINDOW_W = COLS * GRID_SIZE;
const unsigned int WINDOW_H = ROWS * GRID_SIZE;

// --- NODE STRUCTURE ---
struct Node {
    int x, y;
    bool isWall = false;
    bool isDanger = false;
    float riskScore = 0.0f;   // ML-predicted risk in [0,1], used in PUNE_ML modes
    float g = numeric_limits<float>::max();
    float f = numeric_limits<float>::max();
    Node* parent = nullptr;
};

Node* grid[COLS][ROWS];
Node* startNode;
Node* endNode;
vector<sf::Vector2i> pathLine;

// GLOBAL STATE FOR DRAWING TOOL
// 1 = Wall Tool (Grey), 2 = Danger Tool (Red)
int currentTool = 1; 

// --- RISK MODE STATE ---
// MANUAL    : original hand-painted wall/danger behaviour
// PUNE_DAY  : continuous ML-predicted risk grid, daytime scenario
// PUNE_NIGHT: continuous ML-predicted risk grid, nighttime scenario
enum class RiskMode { MANUAL, PUNE_DAY, PUNE_NIGHT };
RiskMode currentMode = RiskMode::MANUAL;
const float ML_RISK_SCALE = 80.0f; // scales [0,1] risk into an A* edge penalty

// --- LOAD A RISK GRID CSV (ROWS lines x COLS comma-separated floats) ---
// Produced by generate_risk_grid.py from the trained Pune risk model.
bool loadRiskGrid(const string& filename) {
    ifstream file(filename);
    if (!file.is_open()) {
        cout << "Could not open risk grid file: " << filename << endl;
        return false;
    }
    string line;
    int y = 0;
    while (getline(file, line) && y < ROWS) {
        stringstream ss(line);
        string cell;
        int x = 0;
        while (getline(ss, cell, ',') && x < COLS) {
            try {
                grid[x][y]->riskScore = stof(cell);
            } catch (...) {
                grid[x][y]->riskScore = 0.0f;
            }
            x++;
        }
        y++;
    }
    file.close();
    cout << "Loaded risk grid: " << filename << endl;
    return true;
}

// --- HEURISTIC ---
float getHeuristic(Node* a, Node* b) {
    return sqrt(pow(a->x - b->x, 2) + pow(a->y - b->y, 2));
}

// --- RESET PATH ONLY ---
void clearPathOnly() {
    pathLine.clear();
    for (int x = 0; x < COLS; x++) {
        for (int y = 0; y < ROWS; y++) {
            grid[x][y]->g = numeric_limits<float>::max();
            grid[x][y]->f = numeric_limits<float>::max();
            grid[x][y]->parent = nullptr;
        }
    }
    cout << "Path cleared! (Map preserved)" << endl;
}

// --- FULL RESET ---
void fullReset() {
    clearPathOnly();
    for(int i=0; i<COLS; i++) {
        for(int j=0; j<ROWS; j++) {
            grid[i][j]->isWall = false;
            grid[i][j]->isDanger = false;
        }
    }
    cout << "Map reset!" << endl;
}

// --- A* ALGORITHM ---
void findPath(bool safeMode) {
    clearPathOnly(); 
    
    vector<Node*> openSet;
    startNode->g = 0;
    startNode->f = getHeuristic(startNode, endNode);
    openSet.push_back(startNode);

    cout << (safeMode ? "Calculating Safe Route..." : "Calculating Shortest Route...") << endl;

    while (!openSet.empty()) {
        int winner = 0;
        for (int i = 0; i < openSet.size(); i++) {
            if (openSet[i]->f < openSet[winner]->f) winner = i;
        }
        Node* current = openSet[winner];

        if (current == endNode) {
            Node* temp = current;
            while (temp != nullptr) {
                pathLine.push_back(sf::Vector2i(temp->x, temp->y));
                temp = temp->parent;
            }
            return;
        }

        openSet.erase(openSet.begin() + winner);

        int dx[] = {0, 0, 1, -1};
        int dy[] = {1, -1, 0, 0};

        for (int i = 0; i < 4; i++) {
            int nx = current->x + dx[i];
            int ny = current->y + dy[i];

            if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) {
                Node* neighbor = grid[nx][ny];

                if (!neighbor->isWall) {
                    float penalty = 0.0f;
                    if (safeMode) {
                        if (currentMode == RiskMode::MANUAL) {
                            if (neighbor->isDanger) penalty = 50.0f;
                        } else {
                            // ML-predicted continuous risk drives the penalty,
                            // instead of a flat cost for a hand-painted zone.
                            penalty = neighbor->riskScore * ML_RISK_SCALE;
                        }
                    }

                    float tempG = current->g + 1 + penalty;

                    if (tempG < neighbor->g) {
                        neighbor->parent = current;
                        neighbor->g = tempG;
                        neighbor->f = neighbor->g + getHeuristic(neighbor, endNode);

                        bool inOpen = false;
                        for(auto n : openSet) if(n == neighbor) inOpen = true;
                        if(!inOpen) openSet.push_back(neighbor);
                    }
                }
            }
        }
    }
    cout << "No path found!" << endl;
}

int main() {
    sf::RenderWindow window(sf::VideoMode({WINDOW_W, WINDOW_H}), "SafeRoute Simulation");

    // Initialize Grid
    for (int x = 0; x < COLS; x++) {
        for (int y = 0; y < ROWS; y++) {
            grid[x][y] = new Node{x, y};
        }
    }
    startNode = grid[2][ROWS/2];
    endNode = grid[COLS-3][ROWS/2];

    // INSTRUCTIONS
    cout << "--- CONTROLS ---" << endl;
    cout << "Key '1' : Select WALL Tool (Grey)" << endl;
    cout << "Key '2' : Select DANGER Tool (Red)" << endl;
    cout << "Left Click : Draw with selected tool" << endl;
    cout << "Right Click: Erase" << endl;
    cout << "------------------" << endl;
    cout << "Key 'S' : Shortest Path (Blue)" << endl;
    cout << "Key 'D' : Safe Path (Avoids Danger / High Risk)" << endl;
    cout << "Key 'C' : Clear Path Only" << endl;
    cout << "Key 'R' : Reset Map" << endl;
    cout << "------------------" << endl;
    cout << "Key 'M' : Manual Mode (hand-painted walls/danger)" << endl;
    cout << "Key 'P' : Pune ML Risk Mode - Daytime (Kothrud-Karve Nagar-Erandwane)" << endl;
    cout << "Key 'O' : Pune ML Risk Mode - Nighttime" << endl;
    cout << "------------------" << endl;

    while (window.isOpen()) {
        while (const auto event = window.pollEvent()) {
            if (event->is<sf::Event::Closed>()) window.close();

            if (const auto* keyPressed = event->getIf<sf::Event::KeyPressed>()) {
                // TOOL SELECTION
                if (keyPressed->code == sf::Keyboard::Key::Num1) {
                    currentTool = 1;
                    cout << "Tool Selected: WALL (Grey)" << endl;
                }
                if (keyPressed->code == sf::Keyboard::Key::Num2) {
                    currentTool = 2;
                    cout << "Tool Selected: DANGER ZONE (Red)" << endl;
                }

                // ACTIONS
                if (keyPressed->code == sf::Keyboard::Key::S) findPath(false);
                if (keyPressed->code == sf::Keyboard::Key::D) findPath(true);
                if (keyPressed->code == sf::Keyboard::Key::C) clearPathOnly();
                if (keyPressed->code == sf::Keyboard::Key::R) fullReset();

                // RISK MODE SWITCHING
                if (keyPressed->code == sf::Keyboard::Key::M) {
                    currentMode = RiskMode::MANUAL;
                    clearPathOnly();
                    cout << "Mode: MANUAL (hand-painted walls/danger)" << endl;
                }
                if (keyPressed->code == sf::Keyboard::Key::P) {
                    currentMode = RiskMode::PUNE_DAY;
                    loadRiskGrid("risk_grid_day.csv");
                    clearPathOnly();
                    cout << "Mode: PUNE ML RISK (Daytime)" << endl;
                }
                if (keyPressed->code == sf::Keyboard::Key::O) {
                    currentMode = RiskMode::PUNE_NIGHT;
                    loadRiskGrid("risk_grid_night.csv");
                    clearPathOnly();
                    cout << "Mode: PUNE ML RISK (Nighttime)" << endl;
                }
            }
        }

        // MOUSE DRAWING
        if (sf::Mouse::isButtonPressed(sf::Mouse::Button::Left)) {
            sf::Vector2i pos = sf::Mouse::getPosition(window);
            int x = pos.x / GRID_SIZE;
            int y = pos.y / GRID_SIZE;
            
            if (x >= 0 && x < COLS && y >= 0 && y < ROWS) {
                // Apply based on Current Tool
                if (currentTool == 1) {
                    grid[x][y]->isWall = true;
                    grid[x][y]->isDanger = false; // Overwrite danger
                } else if (currentTool == 2) {
                    grid[x][y]->isDanger = true;
                    grid[x][y]->isWall = false;   // Overwrite wall
                }
            }
        }
        
        // ERASER
        if (sf::Mouse::isButtonPressed(sf::Mouse::Button::Right)) {
            sf::Vector2i pos = sf::Mouse::getPosition(window);
            int x = pos.x / GRID_SIZE;
            int y = pos.y / GRID_SIZE;
            if (x >= 0 && x < COLS && y >= 0 && y < ROWS) {
                grid[x][y]->isWall = false;
                grid[x][y]->isDanger = false;
            }
        }

        window.clear(sf::Color::Black);

        // DRAW GRID
        for (int x = 0; x < COLS; x++) {
            for (int y = 0; y < ROWS; y++) {
                sf::Vector2f size(static_cast<float>(GRID_SIZE - 1), static_cast<float>(GRID_SIZE - 1));
                sf::RectangleShape rect(size);
                rect.setPosition(sf::Vector2f(static_cast<float>(x * GRID_SIZE), static_cast<float>(y * GRID_SIZE)));

                // Color Logic
                if (grid[x][y]->isWall) rect.setFillColor(sf::Color(100, 100, 100)); // Grey
                else if (currentMode == RiskMode::MANUAL) {
                    if (grid[x][y]->isDanger) rect.setFillColor(sf::Color(255, 50, 50, 200)); // BRIGHT RED
                    else rect.setFillColor(sf::Color::White);
                } else {
                    // Heatmap: interpolate White (safe) -> Red (risky) by ML risk score
                    float r = grid[x][y]->riskScore; // already clamped [0,1] by the export script
                    uint8_t g = static_cast<uint8_t>(255 * (1.0f - r));
                    uint8_t b = static_cast<uint8_t>(255 * (1.0f - r));
                    rect.setFillColor(sf::Color(255, g, b));
                }

                if (grid[x][y] == startNode) rect.setFillColor(sf::Color::Green);
                if (grid[x][y] == endNode) rect.setFillColor(sf::Color::Red);

                window.draw(rect);
            }
        }

        // DRAW PATH
        for (auto& p : pathLine) {
            sf::Vector2f size(static_cast<float>(GRID_SIZE / 2), static_cast<float>(GRID_SIZE / 2));
            sf::RectangleShape pathRect(size);
            pathRect.setPosition(sf::Vector2f(static_cast<float>(p.x * GRID_SIZE + GRID_SIZE/4), static_cast<float>(p.y * GRID_SIZE + GRID_SIZE/4)));
            pathRect.setFillColor(sf::Color::Blue);
            window.draw(pathRect);
        }

        window.display();
    }

    return 0;
}