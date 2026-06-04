# Laser Squad

A modern, browser-based remake of *Laser Squad* — Julian Gollop's 1988 turn-based
tactics game, the forerunner to X-COM. Two players, hot-seat, on one screen.

**▸ [Play it](https://peter-guillam123.github.io/lasersquad/)** · **[About & dev diary](https://peter-guillam123.github.io/lasersquad/about.html)**

Built entirely in conversation with Claude — plain JavaScript and hand-drawn SVG,
no build step and no frameworks. The whole game is a folder of files you can read
end to end.

## What's in it

- Grid movement on an action-point economy — every step, turn and shot costs AP.
- Line of sight: you can't shoot through walls, and where you stand decides what you see.
- **Opportunity fire** — end a turn facing the right way with AP banked and your soldier
  fires on enemies who cross its view next turn. Movement halts the instant you're spotted.
- **Cover** — a wall between shooter and target cuts the hit chance.
- **Fog of war** — enemies are hidden until your squad spots them, with faded "last seen"
  markers and a pass-the-device handoff between turns.

Placeholder graphics for now (coloured discs with a facing notch); a proper art pass comes later.

## Run it locally

No build step. Serve the folder with the included no-cache dev server:

```sh
python3 serve.py
```

Then open <http://localhost:8753>. (Any static server works; the included one just
disables caching so edits always load.)

## How to play

Click a soldier to select it. Highlighted tiles are within reach — **blue** means you'll
still have the action points to react next turn, **grey** means moving spends you out.
Click a tile to move, an enemy in a red reticle to fire, or an arrow in the ring around a
soldier to turn it on the spot. Hover any soldier to see the tiles it can watch. End your
turn to hand the screen to the other player. Last squad standing wins.

## Status

A playable two-player tactical game. Next up: doors, grenades and destructible walls,
then a proper SVG art pass, then a computer opponent. See the
[dev diary](https://peter-guillam123.github.io/lasersquad/about.html) for the full story.

---

*Inspired by Julian Gollop's Laser Squad (1988). This is a fan remake, not affiliated with
the original.*
