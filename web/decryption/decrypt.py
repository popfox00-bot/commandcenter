#!/usr/bin/env python3
"""Open Command Center Saved Files encrypted files ("ccv." files from Drive) without the app.

Needs Python 3 and the "cryptography" package:    pip install cryptography

Usage:
    python3 decrypt.py FILE [FILE ...]                 asks for the password or recovery key
    python3 decrypt.py --vault command-center-vault.json FILE ...
        (for files saved before a password change: the vault file's current password opens them)

Each file is written next to it under its original name (never over an existing file).
The format is described in FORMAT.md.
"""
import base64
import getpass
import json
import os
import re
import struct
import sys

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
except ImportError:
    sys.exit('This needs the "cryptography" package: pip install cryptography')

B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'


def recovery_key(secret):
    """The cleaned recovery key (32 letters and digits), or None if the text can't be one."""
    t = re.sub(r'[^A-Z0-9]', '', secret.upper())
    return t if len(t) == 32 and all(c in B32 for c in t) else None


def unwrap(wrap, secret, iterations):
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=base64.b64decode(wrap['salt']), iterations=iterations)
    kek = kdf.derive(secret.encode('utf-8'))
    return AESGCM(kek).decrypt(base64.b64decode(wrap['iv']), base64.b64decode(wrap['ct']), None)


def data_key(header, secret):
    """The data key from the password or the recovery key; raises ValueError if neither opens it."""
    tries = [(header['password'], secret)]
    rk = recovery_key(secret)
    if rk:
        tries.append((header['recovery'], rk))
    for wrap, s in tries:
        try:
            return unwrap(wrap, s, header['iterations'])
        except Exception:
            pass
    raise ValueError('Wrong password or recovery key.')


def open_file(data, secret, vault=None):
    """(original name, type, bytes) from an encrypted file's bytes."""
    if data[:4] != b'CCV1':
        raise ValueError('Not a Saved Files encrypted file.')
    (hl,) = struct.unpack('>I', data[4:8])
    header = json.loads(data[8:8 + hl].decode('utf-8'))
    iv = data[8 + hl:20 + hl]
    ct = data[20 + hl:]
    try:
        key = data_key(header, secret)
    except ValueError:
        if not vault:
            raise
        key = data_key(vault, secret)
    try:
        body = AESGCM(key).decrypt(iv, ct, None)
    except Exception:
        raise ValueError("This file couldn't be opened with that key (or it was changed).")
    (ml,) = struct.unpack('>I', body[:4])
    meta = json.loads(body[4:4 + ml].decode('utf-8'))
    return meta['n'], meta['t'], body[4 + ml:]


def free_path(folder, name):
    name = os.path.basename(name) or 'file'
    path = os.path.join(folder, name)
    stem, ext = os.path.splitext(name)
    n = 2
    while os.path.exists(path):
        path = os.path.join(folder, f'{stem} ({n}){ext}')
        n += 1
    return path


def main(argv):
    args = list(argv)
    vault = None
    if '--vault' in args:
        i = args.index('--vault')
        with open(args[i + 1], 'rb') as f:
            vault = json.loads(f.read().decode('utf-8'))
        del args[i:i + 2]
    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        return 0 if args else 1
    secret = os.environ.get('CCV_SECRET') or getpass.getpass('Password or recovery key: ')
    failed = 0
    for path in args:
        try:
            with open(path, 'rb') as f:
                name, kind, content = open_file(f.read(), secret, vault)
            out = free_path(os.path.dirname(os.path.abspath(path)), name)
            with open(out, 'wb') as f:
                f.write(content)
            print(f'{path} -> {out} ({kind}, {len(content)} bytes)')
        except Exception as err:
            failed += 1
            print(f'{path}: {err}', file=sys.stderr)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
