# Imagery

Drop photographs here, name the photographer in `credits.json`, then run:

```
npm run imagery
```

That writes AVIF and WebP at two widths into `public/imagery/`, along with a
manifest carrying each image's aspect ratio, a 4×4 average used as the
placeholder, and the credit. Both the source files and the generated output are
committed — the app fetches nothing at runtime.

## What belongs here

Calm and unpeopled: water, stone, mist, foliage, horizon. SPEC.md §8 asks for
60–90 so that nothing repeats within a season, but the app works with any
number, including none. Landscape or portrait both work; the aspect ratio is
read per image and the layout reserves the right space before the file arrives.

## Rules the build enforces

- Nothing over 150KB. Quality is stepped down to fit, and the run fails loudly
  naming any file that still cannot, so it can be cropped tighter or dropped.
- Images are never upscaled. An original narrower than 1600px keeps its width.
- EXIF orientation is applied before anything else, so a photo taken sideways on
  a phone is not stored sideways.

## credits.json

Keyed by filename without its extension:

```json
{
  "still-water": { "photographer": "A. Name", "url": "https://…", "license": "Unsplash License" }
}
```

An image with no entry still builds; it simply carries no credit line.
