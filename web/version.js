// The app's version and what changed in each, newest first: shown small at the top right of the home
// screen (tap it for this list). One version per update that went out (the number counts them).
// Add an entry at the top with each update.

/** @type {{ v: string, date: string, notes: string }[]} */
export const HISTORY = [
  { v: '1.64', date: '2026-11-14', notes: 'Fashion: sharper results — saved at full size from the piece\'s own photo, no streaks where a piece is stretched, no stair-step edges where two people meet, no specks through the new piece. Body zones: neck to waist by the body itself (not where the clothes change color), one clean outline of that person with the hair over their shoulders; both bare-armed, torso onto torso, each keeping their own arms.' },
  { v: '1.63', date: '2026-11-14', notes: 'Fashion: group photos — pick whose clothes and who to dress (tap a face or tap them); body zones take the skin too (arms, shoulders), not just what\'s worn; a dress laid in to its hem; the old garment\'s straps take the new color. Version history on the home screen.' },
  { v: '1.62', date: '2026-11-13', notes: 'Fashion: body zones tell skin from clothing part by part (a tank top onto a jacket and back).' },
  { v: '1.61', date: '2026-11-13', notes: 'Fashion: Replace lays the piece\'s design into the base\'s own garment outline; body zones (upper body, lower body, whole outfit); save fixed for large photos.' },
  { v: '1.60', date: '2026-11-13', notes: 'Fashion: realistic on real photos (solid, sized by the body, white stays white); a list of what\'s found in the photo; More edits.' },
  { v: '1.59', date: '2026-11-12', notes: 'Fashion: sleeves fitted right on larger photos.' },
  { v: '1.58', date: '2026-11-12', notes: 'Magic: Reverse Fill and Fashion as apps of their own; Reverse Fill patterns, hold to compare, open in Fashion.' },
  { v: '1.57', date: '2026-11-11', notes: 'FM: the photo\'s own forehead toward the hairline, color blotches evened out, a parted mouth closed to match.' },
  { v: '1.56', date: '2026-11-10', notes: 'Downloads: save batches packed by size; stills under each queued link; Download all smallest first, several at once.' },
  { v: '1.55', date: '2026-11-10', notes: 'Downloads: Save all in small batches so a phone doesn\'t run out of memory.' },
  { v: '1.54', date: '2026-11-10', notes: 'Downloads: Save all — every downloaded file in the queue to the phone in one go.' },
  { v: '1.53', date: '2026-11-10', notes: 'Downloads: simpler — four stills and size · length up front, the rest under More.' },
  { v: '1.52', date: '2026-11-10', notes: 'Downloads: its own app with Download, Queue and History; links checked by themselves.' },
  { v: '1.50', date: '2026-11-10', notes: 'Files → Download: a video from a link, with safeguards and a download manager.' },
  { v: '1.49', date: '2026-11-05', notes: 'Reverse Fill: no outline left around what\'s removed.' },
  { v: '1.48', date: '2026-11-05', notes: 'Swap scoring: aligned, shape and seam, on your own photos.' },
  { v: '1.47', date: '2026-11-05', notes: 'FM: no old features showing past the new face; lighting from the face\'s shape; Compare looks.' },
  { v: '1.46', date: '2026-11-05', notes: 'FM: keeps the Character\'s own mouth and pose by default.' },
  { v: '1.45', date: '2026-11-05', notes: 'FM: face-part maps, fine-tune and brush after the fit; fitting off the main thread.' },
  { v: '1.44', date: '2026-11-05', notes: 'FM: Reverse Fill with a color picker and automatic outline; skin texture, upscaling.' },
  { v: '1.43', date: '2026-11-04', notes: 'FM: dense face mesh (offline); matched sharpness and grain.' },
  { v: '1.41', date: '2026-11-04', notes: 'FM: the mouth and the light follow the face it goes on; the face toned like the base\'s skin.' },
  { v: '1.40', date: '2026-11-04', notes: 'Weather and Sports: two apps of their own on the home screen.' },
  { v: '1.39', date: '2026-11-04', notes: 'FaceMask: Quick Swap — two photos in, a finished face swap out.' },
  { v: '1.30', date: '2026-11-04', notes: 'FaceMask: cut out a face or put in a Character, fitted and blended in; a magnifier under the finger.' },
  { v: '1.27', date: '2026-10-31', notes: 'Rap app: write lyrics with next-word, complete-the-line and rhyme suggestions.' },
  { v: '1.26', date: '2026-10-31', notes: 'Cutout: a stronger patch fix, plus Wand, Brush and a magnifier.' },
  { v: '1.23', date: '2026-10-30', notes: 'Saved Files: folders, a decryption kit to open them without the app.' },
  { v: '1.21', date: '2026-10-30', notes: 'Files, Draw, QR and Calendar on the home screen; Sports as a calendar; Saved Files in Google Drive.' },
  { v: '1.18', date: '2026-10-24', notes: 'Settings app: an app-wide background color; Draw, a blank canvas.' },
  { v: '1.13', date: '2026-10-23', notes: 'Auto-Crop: find the post\'s media in feed screenshots.' },
  { v: '1.11', date: '2026-10-23', notes: 'Editor: clean-line Auto-Crop detection.' },
  { v: '1.7', date: '2026-10-17', notes: 'QR & Barcode: scan with a link safety check, make styled QR codes.' },
  { v: '1.6', date: '2026-10-17', notes: 'Editor: Collage, Superimpose and Cutout with a Characters library.' },
  { v: '1.4', date: '2026-10-17', notes: 'Photo Editor.' },
  { v: '1.0', date: '2026-10-15', notes: 'Command Center: the first version.' },
];

/** The version running now. */
export const VERSION = HISTORY[0].v;
