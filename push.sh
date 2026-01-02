#!/bin/bash

set -e  # Bei Fehler abbrechen

echo "Stage Pflichtdateien..."
git add -f server.js public/index.html

echo "Stage alle weiteren Änderungen..."
git add .

echo "Committe (auch ohne Änderungen)..."
git commit --allow-empty -m "Auto commit: $(date '+%Y-%m-%d %H:%M:%S')"

echo "Pushe auf GitHub..."
git push origin main

echo "Fertig! server.js und public/index.html wurden garantiert gepusht."
