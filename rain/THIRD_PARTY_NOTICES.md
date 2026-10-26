# Glass rain sources

This directory adapts the surface-water modules and two droplet sprites from
Over-the-Window. Its video, music, controls, pointer interaction, background
renderer and air-force calculations are excluded. The original quiet rainfall
baseline, droplet collisions, friction, path variation, deformation and trails
are retained, with fixed logical pane sizes and a bounded 30 Hz simulation.

## Heartfelt

Heartfelt by Martijn Steinrucken (BigWings), 2017.
Source: https://www.shadertoy.com/view/ltffzl

The original shader declares Creative Commons Attribution-NonCommercial-
ShareAlike 3.0 Unported (CC BY-NC-SA 3.0):
https://creativecommons.org/licenses/by-nc-sa/3.0/

The adapted cell hashes, static bead field, spawn positions and lateral paths
in `heartfelt-field.js`, and Heartfelt rendering functions in `window-material.js`,
are distributed under those same terms. Attribution, noncommercial use and
sharing adaptations under the same license apply. Commercial use outside those
terms requires separate permission from the author. The original N13 hash
credits Dave Hoskins.

Changes include app-driven clocks, CPU collision sharing, stateful moving heads,
shared deformation and trail masks, and projection onto world-space glass.
The original heart story, lightning, background media and audio are excluded.

## Codrops RainEffect

Rain & Water Effect Experiments by Lucas Bebber / Codrops.
Demo: https://tympanus.net/Development/RainEffect/
Source: https://github.com/codrops/RainEffect
License referenced by the original package:
https://tympanus.net/codrops/licensing/

The original `assets/drop-alpha.png` and `assets/drop-color.png` sprites are used.
Size-based release, spreading recovery, trail births, 80% radius-squared-area
merges, RGBA sprite composition and refraction formulas derive from RainEffect.
Over-the-Window adds mass-based fall speed, bounded populations, local friction
and adhesion, coherent path noise, shared deformation, rotation, and collisions
between Codrops droplets and the Heartfelt microtexture. This adaptation keeps
those surface-water behaviors and replaces the standalone renderer with the
cafe's Three.js window material.
