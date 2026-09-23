# Throwing Light

A potter's wheel where the clay is 240,000 grains of light.

**[amyleesterling.github.io/pottery-wheel](https://amyleesterling.github.io/pottery-wheel/)**

Drag across the spinning clay to throw it. Pull the wall out and upward, press it back in, smooth a band, or leave throwing rings in it. Then fire the piece and watch the grains condense out of a loose shell onto the surface as the kiln climbs past cone 06.

This is a remake of [3D Pottery](https://artsandculture.google.com/experiment/3d-pottery/nwHg1D0riJ1ltA), made by Lingdong Huang with Google Arts & Culture Lab Artist in Residence Caroline Buttet, published April 2022. The original asks you to throw clay and match historic pots. This version keeps that idea and changes the material: the vessel is particles, hologram and beam rather than a solid surface.

## Three worlds of light

The chrome is neutral on purpose. Every colour on the page comes from the light in the scene, and the interface accent follows whichever world is running.

| | |
|---|---|
| **Kiln** | Cold blue while the clay is wet, climbing through amber to ember as it fires. The palette is the temperature. |
| **Lab** | A scanning rig. Sweep lines and a calibration tick every ring. |
| **Nacre** | Thin film interference, so the hue turns with the angle you see it from. |

## How it works

The vessel is never a mesh you edit. It is **one array of 192 wall radii**, uploaded to a 192 by 1 half-float texture. Four things read that same array every frame:

1. 240,000 GPU particles, positioned entirely in the vertex shader
2. a hologram shell with a grazing-angle rim
3. the reference ghost
4. the centimetre readout and the match score

So a stroke uploads 192 numbers and nothing rebuilds geometry. That is what keeps it fluid at a quarter million points.

Sculpting raycasts onto a section plane that contains the wheel axis and faces the camera, which makes horizontal drag the radius and vertical drag the height. Pulling the wall upward raises the piece, the way it does on a real wheel.

`RedFormat` plus `HalfFloatType` is deliberate: half float is filterable in core WebGL2, where `R32F` needs an extension that is missing on plenty of mobile GPUs.

Colour is authored linear throughout. `OutputPass` applies tone mapping and the sRGB transfer, so no shader encodes anything itself.

## The historic forms

Seven reference vessels sit behind your clay as a still wireframe while the wheel turns: amphora, aryballos, moon jar, hydria, olla, Jomon deep vessel, lekythos.

**These are stylized profiles, drawn by eye from the general shape of each vessel type. They are not measured archaeological drawings**, and the heights are typical for the type rather than a specific object. The page says so on screen. The match score is reported as two separate numbers, silhouette shape and proportion, because those are two different things to get wrong.

## Controls

| | |
|---|---|
| Drag | Throw the clay |
| Shift drag, two fingers, or Orbit | Walk around the wheel |
| Scroll | Move closer or further |
| `1` to `5` | Centre, pull, press, smooth, ribs |
| Space | Fire |
| `R` | Recentre the clay |

## Running it

No build step. Any static server works, because ES modules will not load over `file://`.

```bash
python -m http.server 8731
```

Then open `http://127.0.0.1:8731/`.

## Built with

[three.js](https://threejs.org) r180, loaded from a CDN through an import map. `EffectComposer` with `UnrealBloomPass` for the glow. Type is [Cardo](https://fonts.google.com/specimen/Cardo), a face cut for ancient texts, paired with IBM Plex Mono for every number.

## Files

```
index.html        page shell, interface, styles
src/profile.js    the 192-radius model, the tools, the seven forms, the score
src/shaders.js    every GLSL program
src/app.js        scene, sculpting, firing, loop
```
