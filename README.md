# 19 / Erosion

A fixed cloud of mineral sand fills the space around a stationary charcoal ball at the world origin. Quartz, sandstone, basalt, ochre, shell and mica catch the light differently as they tumble. A stippled plan on the floor follows the grains overhead.

## Simulation

65,536 grains occupy a pair of 256 × 256 GPU state textures. Every grain starts at rest. Between laser pulses, grains accelerate toward the world origin. Velocity damping controls how quickly moving grains lose speed. At each tick a GPU grid stores up to two grain IDs per cell for neighbor lookup. The contact pass checks the actual distance between grain centers, separates overlapping pairs, and dissipates slip with contact friction. Grains landing on the sphere or on settled grains can come to rest. The grid is an approximation that trades some missed contacts in crowded cells for a fixed lookup cost. Six instanced convex hulls give the grains distinct silhouettes, colors, roughness and metalness. Each grain's contact radius follows its rendered size. Sliding friction lets neighboring facets slip into gaps before the grains settle. Spin and translation run on the GPU.

The laser fires at the selected frequency in simulated seconds. The default is 0.30 Hz, or one pulse about every 3.3 seconds. Each subsequent pulse arrives from another seeded direction and ends at the first grain along its path. A shallow patch of sand lifts outward and fans over the rim. Attraction draws the ejected grains back into the pile. The beam and the impact share a single GPU hit point.

Box3D holds the sphere at the origin in a zero-gravity world. The GPU uses its center and radius for sphere collisions. The ball defaults to a radius of 0.775 units and a rough, nonmetallic standard material lit by the studio lights.

## Studio

The seeded studio shell comes from the archived `14-tension-deadend` sketch. It includes the established controls drawer, camera and orbit gestures, PNG export, editable materials and lights, shadows, palette workshop, AO, bloom, tilt blur, FPS meter and two Strudel voices. The GPU state textures and instanced grain rendering follow `17-klep`. The dependency versions match `18-pendulum`. The lighting and palette tools follow the shared studio used in `02-shatter-drafting` and `04-tangle-drafting`.

Press **H** for the drawer, **P** to pause, **M** for sound and **F** to audition the voices. Drag to orbit, right-drag to pan and scroll to zoom. The Physics tab controls sphere radius, attraction, grain friction, velocity damping, collision bounce, contact stiffness and settling speed. Higher stiffness separates overlapping grains faster. Higher settling speed lets supported grains come to rest sooner. The Laser section sets beam color and pulse frequency. Set frequency to zero to turn off the pulses. Regenerate selects a new seed. Save records the seed, camera and studio settings. Reload reconstructs the initial cloud. Sound starts muted.

Development settings use the series’ verified GET/PUT endpoint and `public/settings.json`. Static builds save per device and sketch URL.

## Run

Run `npm run dev` from this folder in the VS Code terminal and use `http://127.0.0.1:1234/`. The sketch requires WebGL 2 with floating-point render targets. On a fresh checkout, install the locked dependencies with `pnpm install --frozen-lockfile`. Run `npm run check` for the tests and production build.

