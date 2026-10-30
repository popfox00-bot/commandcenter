# Command Center Saved Files: how the encrypted files work

This explains, byte by byte, how files saved to Drive with encryption on are made, so they can be
opened without the Command Center app: with `decrypt.html` (any web browser, offline), with
`decrypt.py` (Python 3), or with any program written from this description. You need the file and
**your password or your recovery key**. Nothing else (no account, no server, no app).

Standard algorithms only:
- **PBKDF2-HMAC-SHA256** turns your password or recovery key into a key-encryption key.
- **AES-256-GCM** (12-byte IV, 16-byte tag at the end of the ciphertext) encrypts everything.
- **Base64** (standard) and **base64url** (URL-safe, no padding) write bytes as text.

## 1. Your password and recovery key

- **Password:** exactly as typed, encoded as UTF-8.
- **Recovery key:** shown as 8 groups of 4, like `ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789`. Before use
  it is cleaned: upper case, and everything except letters and digits removed (32 characters, e.g.
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`). The cleaned text, as UTF-8, is the secret.

## 2. The data key

Every vault has one random 32-byte **data key** that encrypts the files. It is stored only
**wrapped**, twice: once with the password, once with the recovery key. Each wrap is a JSON object:

```json
{ "salt": "<16 bytes, base64>", "iv": "<12 bytes, base64>", "ct": "<48 bytes, base64>" }
```

To unwrap:

1. `kek = PBKDF2-HMAC-SHA256(secret, salt, iterations, 32 bytes)` (iterations: 600000, as written in
   the header).
2. `dataKey = AES-256-GCM-decrypt(key = kek, iv, ct)` → 32 bytes. If the password is wrong, the
   decryption fails (the GCM tag doesn't match).

## 3. An encrypted file

Its name in Drive starts with `ccv.`. Its bytes, in order:

| Bytes | What |
| --- | --- |
| 4 | the ASCII text `CCV1` |
| 4 | the header's length in bytes, `H` (unsigned, big-endian) |
| H | the header: UTF-8 JSON `{ "v": 1, "iterations": 600000, "password": <wrap>, "recovery": <wrap> }` |
| 12 | the IV |
| the rest | AES-256-GCM ciphertext (with its 16-byte tag at the end), encrypted with the data key |

Decrypting the rest (with the data key from section 2 and that IV) gives:

| Bytes | What |
| --- | --- |
| 4 | the length of the file's details, `M` (unsigned, big-endian) |
| M | UTF-8 JSON: `{ "n": "<original name>", "t": "<type, like image/png>", "s": <size>, "at": <saved, ms since 1970> }` |
| the rest | **the original file**, byte for byte |

So one file plus the password (or recovery key) is enough: the wrapped data key travels with it.

## 4. The file's name in Drive

`ccv.` followed by base64url of: a 12-byte IV, then AES-256-GCM (data key) of the UTF-8 JSON
`{ "n": "<name>", "t": "<type>", "s": <size> }`. A very long name is shortened here (to keep the Drive
name under 200 characters); the full name is inside the file (section 3).

## 5. The vault file

`command-center-vault.json` in the same folder holds the current wraps:

```json
{ "v": 1, "kdf": "PBKDF2-SHA256", "iterations": 600000, "password": <wrap>, "recovery": <wrap>, "created": <ms> }
```

After **Change password**, this file has the new password's wrap, while files saved earlier still carry
the wrap of the password at the time they were saved. The **recovery key** opens every file saved
since it was made. To open an older file with a newer password, unwrap the data key from this vault
file (section 2) and use it on the file (section 3): the data key never changes.

## 6. Without the password and the recovery key

The files can't be opened. That's the point: nobody else can either.
