// @ts-check
// The shapes FaceMask's fitting passes around, for type checking (`npm run typecheck`); no code.

/**
 * A face found in a picture (lib/face-core.js), 0..1 of it.
 * @typedef {object} Face
 * @property {{ x: number, y: number, w: number, h: number }} box
 * @property {number[][]} pts the 68 landmarks (iBUG layout), [u, v]
 * @property {number[][]} [eyes]
 * @property {number[]} [mouth]
 * @property {number[]} [nose]
 * @property {number} [angle]
 * @property {number} [score]
 * @property {number} [size]
 * @property {number[][]} [mesh] its dense mesh when found by it: 478 [u, v, z] (z into the picture, in units of u)
 * @property {number[][]} [outline] its outline in the photo, pixels (fit-skin targetOutline), once worked out
 * @property {{ isSkin: (r: number, g: number, b: number) => boolean }} [skin] its skin, as a test (fit-skin skinModel)
 */

/**
 * Patch pixels: what's painted onto the photo at (x0, y0), RGBA pw × ph (alpha: how much of it).
 * @typedef {object} Patch
 * @property {number} x0 @property {number} y0 @property {number} pw @property {number} ph
 * @property {Uint8ClampedArray} rgba
 * @property {number[][] | null} [charPts] the Character's landmarks as placed, photo pixels
 * @property {number[] | null} [open] an opened mouth's see-through pixels (indices), kept so by the blend
 * @property {Record<string, number>} [timings] how long each step took (ms)
 */

/** An RGBA picture. @typedef {{ rgba: Uint8ClampedArray, w: number, h: number }} Pixels */

/** A face-part map (lib/face-parts.js), 0..255 how sure, w × h over the whole picture. @typedef {{ w: number, h: number, hair: Uint8Array, face: Uint8Array }} Parts */

/** A brush stroke on the new face (photo pixels). @typedef {{ pts: number[][], r: number, add: boolean }} Stroke */

/** Fine-tuning after the fit. @typedef {{ scale: number, rot: number, dx: number, dy: number, soft: number }} Tune */

/**
 * How it's fitted and blended.
 * @typedef {object} FitOptions
 * @property {boolean} [trim] @property {number} [blend] 0–100
 * @property {Tune | null} [tune] @property {Stroke[] | null} [paint] @property {Parts | null} [parts]
 * @property {boolean} [turn3d] turned in 3D to its pose @property {boolean} [mouth] its mouth matched
 * @property {boolean} [keepShape] its own shape kept (placed as one piece, its own outline; the default)
 */

export {};
