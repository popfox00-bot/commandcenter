#!/usr/bin/env python3
"""Open Command Center encrypted files without the app: Saved Files' ("ccv." files from Drive) and Reader's
packages (.ccv: one file, or a whole package of files and folders, any size).

Needs Python 3 and the "cryptography" package:    pip install cryptography

Usage:
    python3 decrypt.py FILE [FILE ...]                 asks for the password or recovery key
    python3 decrypt.py --vault command-center-vault.json FILE ...
        (for files saved before a password change: the vault file's current password opens them)

    python3 decrypt.py --list PACKAGE.ccv              what's in a Reader package (nothing written)

Each file is written next to it under its original name (never over an existing file); a Reader package of
several files into a folder of its name, its folders kept, a piece at a time (any size).
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


def _aad(stream, index, last):
    return stream.encode('ascii') + struct.pack('>II', index // 2**32, index % 2**32) + (b'\x01' if last else b'\x00')


def _pieces(f, aes, stream, pos, index=0):
    """The decrypted pieces of one stream of a package (CCV2), from byte `pos`, until its last."""
    while True:
        f.seek(pos)
        (L,) = struct.unpack('>I', f.read(4))
        iv = f.read(12)
        ct = f.read(L + 16)
        if len(ct) < L + 16:
            raise ValueError('This package is cut short (copied only partly?).')
        for last in (False, True):
            try:
                plain = aes.decrypt(iv, ct, _aad(stream, index, last))
                break
            except Exception:
                plain = None
        if plain is None:
            raise ValueError("This package couldn't be opened with that key (or it was changed).")
        yield plain
        if last:
            return
        pos += 32 + L
        index += 1


def open_package(f, secret):
    """(AESGCM, header start of pieces, contents list) of a Reader package (CCV2) open for reading."""
    f.seek(0)
    head = f.read(8)
    (hl,) = struct.unpack('>I', head[4:8])
    header = json.loads(f.read(hl).decode('utf-8'))
    f.seek(-16, os.SEEK_END)
    tail = f.read(16)
    if tail[12:] != b'CCVE':
        raise ValueError('This package is incomplete (its end is missing: copied only partly?).')
    hi, lo = struct.unpack('>II', tail[:8])
    aes = AESGCM(data_key(header, secret))
    listing = json.loads(b''.join(_pieces(f, aes, 'M', hi * 2**32 + lo)).decode('utf-8'))
    return aes, 8 + hl, listing


def safe_rel(path):
    """A path inside the output folder: no drive, no "..", no leading slash."""
    parts = [p for p in re.split(r'[\\/]+', path) if p not in ('', '.', '..')]
    return os.path.join(*[re.sub(r'[<>:"|?*\x00-\x1f]', '_', p) for p in parts]) if parts else 'file'


def extract_package(path, secret):
    """Every file of a Reader package written out, a piece at a time: into a folder of the package's name."""
    with open(path, 'rb') as f:
        aes, start, listing = open_package(f, secret)
        base = os.path.splitext(os.path.abspath(path))[0]
        out_dir = base
        n = 2
        while os.path.exists(out_dir):
            out_dir = f'{base} ({n})'
            n += 1
        os.makedirs(out_dir)
        buf = bytearray()
        gen = _pieces(f, aes, 'C', start)

        def need(k):
            while len(buf) < k:
                buf.extend(next(gen))
            out = bytes(buf[:k])
            del buf[:k]
            return out

        import zlib
        count = 0
        while True:
            tag = need(1)
            if tag == b'X':
                break
            if tag != b'F':
                raise ValueError('This package is damaged.')
            (jl,) = struct.unpack('>I', need(4))
            meta = json.loads(need(jl).decode('utf-8'))
            target = os.path.join(out_dir, safe_rel(meta['n']))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, 'wb') as out:
                while True:
                    t = need(1)
                    if t == b'E':
                        break
                    (kl,) = struct.unpack('>I', need(4))
                    body = need(kl)
                    out.write(zlib.decompress(body, -15) if meta.get('z') else body)
            count += 1
        return out_dir, count, listing


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
    listing_only = '--list' in args
    if listing_only:
        args.remove('--list')
    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        return 0 if args else 1
    secret = os.environ.get('CCV_SECRET') or getpass.getpass('Password or recovery key: ')
    failed = 0
    for path in args:
        try:
            with open(path, 'rb') as f:
                magic = f.read(4)
            if magic == b'CCV2':
                if listing_only:
                    with open(path, 'rb') as f:
                        _, _, listing = open_package(f, secret)
                    for e in listing['files']:
                        print(f"{e['s']:>14,}  {e['n']}")
                    print(f"{listing['count']} files, {listing['size']:,} bytes")
                    continue
                out_dir, count, listing = extract_package(path, secret)
                print(f'{path} -> {out_dir} ({count} files, {listing["size"]:,} bytes)')
                continue
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
