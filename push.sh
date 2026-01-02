#!/bin/bash

# Skript zum automatischen Speichern und Pushen von Änderungen auf GitHub

echo "Füge alle Änderungen hinzu..."
git add .

echo "Committe die Änderungen..."
git commit -m "Auto commit: $(date)"

echo "Pushe auf GitHub..."
git push origin main

echo "Fertig! Alle Änderungen wurden gespeichert und gepusht."