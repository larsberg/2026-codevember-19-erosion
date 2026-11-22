# 19 / Erosion

A fixed cloud of mineral sand fills the space around a stationary charcoal ball at the world origin. Quartz, sandstone, basalt, ochre, shell and mica catch the light differently as they tumble. A stippled plan on the floor follows the grains overhead.

## Simulation

65,536 grains occupy a pair of 256 × 256 GPU state textures. Every grain starts at rest. Between laser pulses, grains accelerate toward the world origin. Velocity damping controls how quickly moving grains lose speed. At each tick a GPU grid stores up to two grain IDs per cell for neighbor lookup. The contact pass checks the actual distance between grain centers, separates overlapping pairs, and dissipates slip with contact friction. Overlapping grains separate in small steps. Several nearby grains can support a resting grain together, and a small contact tolerance keeps it steady until its support moves or an impact dislodges it. The grid is an approximation that trades some missed contacts in crowded cells for a fixed lookup cost. One indexed, instanced draw renders all six mineral hulls with their own silhouettes, colors, roughness and metalness. Each grain's contact radius follows its rendered size. Sliding friction lets neighboring facets slip into gaps before the grains settle. Spin and translation run on the GPU.

The laser fires at the selected frequency in simulated seconds. The default is 0.30 Hz, or one pulse about every 3.3 seconds. Each subsequent pulse arrives from another seeded direction and ends at the first grain along its path or on the bare sphere. A shallow patch of sand lifts outward and fans over the rim. Attraction draws the ejected grains back into the pile. The sphere glows orange under the impact and cools to charcoal in 0.8 simulated seconds.

Box3D holds the sphere at the origin in a zero-gravity world. The GPU uses its center and radius for sphere collisions. The ball defaults to a radius of 0.775 units and a rough, nonmetallic standard material lit by the studio lights. **Physics → Floor gap (units)** sets the clearance between the bottom of the sphere and the ground. The default gap is 0.20 units. The floor, grid, grain projection and collision plane move together. Hard floor strikes return 45% of the incoming vertical speed at minimum **Collision bounce** and 100% at maximum. Gentle contacts settle.

## Studio

The seeded studio shell comes from the archived `14-tension-deadend` sketch. It includes the established controls drawer, camera and orbit gestures, PNG export, editable materials and lights, shadows, palette workshop, AO, bloom, tilt blur and FPS meter. The GPU state textures and instanced grain rendering follow `17-klep`. The dependency versions match `18-pendulum`. The lighting and palette tools follow the shared studio used in `02-shatter-drafting` and `04-tangle-drafting`.

Press **H** for the drawer and **P** to pause. Drag to orbit, right-drag to pan and scroll to zoom. Set the closest and farthest zoom in the Camera tab with Minimum distance and Maximum distance. The Physics tab controls sphere radius, attraction, grain friction, velocity damping, collision bounce, contact stiffness and settling speed. Higher stiffness separates overlapping grains faster. Higher settling speed lets supported grains come to rest sooner. The Laser section sets the tint of the thin, dark line and the pulse frequency. Set frequency to zero to turn off the pulses. Regenerate selects a new seed. Save records the seed, camera and studio settings. Reload reconstructs the initial cloud.

The **Drafting** tab sets the number of grid cells across the floor, grid opacity, projection opacity, ink color and dot size. **Grains plotted (%)** draws a repeatable sample of grain XZ positions. Set it to 100 for the complete plan, or enable the horizontal slice to measure a band at the chosen height and thickness above the floor.

Each grain turns in one direction around its own fixed axis. Once its speed exceeds 0.12 world units per second, it starts spinning. The rate holds as the grain slows or bounces. After it settles onto a support, contact friction brings its spin to rest over 0.2 seconds. The Physics tab’s **Grain rotation scale (×)** slider adjusts spin live from 0× to 30× and defaults to 10×. At 1× a spinning grain turns at 1.6 radians per second. Enable **Contact shading · GTAO** under **Lighting** to include the moving facets in the half-resolution depth and normal pass. **AO only · preview** isolates the resulting shading.

The collision solver runs at 40 Hz. Rendering interpolates grain position and spin between ticks at the display refresh rate. The renderer caps its pixel ratio at one and reuses the static sphere’s shadow map until its lighting, size or shadow projection changes. The sketch runs silently.

Development settings use the series’ verified GET/PUT endpoint and `public/settings.json`. Static builds save per device and sketch URL.

## Run

Run `npm run dev` from this folder in the VS Code terminal and use `http://127.0.0.1:1234/`. The sketch requires WebGL 2 with floating-point render targets. On a fresh checkout, install the locked dependencies with `pnpm install --frozen-lockfile`. Run `npm run check` for the tests and production build.

