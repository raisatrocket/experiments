# experiments
My testing grounds for experiments at work.

## The Lawn Club 🎾

A Wimbledon-inspired grass court tennis game, played from behind the baseline
against a computer opponent. Best of three games, real tennis scoring
(15/30/40, deuce, advantage).

- **Swing with the mouse** — your racket shadows the cursor, and swing speed
  sets the pace of the shot.
- **Shape the ball** — brush upward for topspin, carve down for slice, or
  barely move for a drop shot. Click to toss on your serve and strike at the
  top for a flat one.
- **All sound is synthesized live** with the Web Audio API — ball strikes,
  polite applause, crowd murmur, birdsong, and a summer breeze. No audio files.

Run it with any static file server:

```sh
python3 -m http.server
# then open http://localhost:8000
```

No build step, no dependencies — plain HTML/CSS/JS modules. Fonts are vendored
in `fonts/`.
