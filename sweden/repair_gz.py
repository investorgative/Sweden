"""Repair collector hour files that hold a cut-off gzip member followed by more data.

A collector killed without closing its file (power loss, kill -9, tmux killed before the clean stop of
stop.sh) leaves the hour file's last gzip member unfinished. If a new collector run then appended to the same file,
normal readers stop at the cut. This recovers every complete line from every member and rewrites the file as one
clean gzip member; the original is kept in data/broken/.

Usage:  python3 sweden/repair_gz.py [file ...]      (default: check every hour file, repair the broken ones)
"""
import glob, gzip, json, os, shutil, sys, zlib

DATA = os.environ.get("SWEDEN_DATA", os.path.join(os.path.dirname(__file__), "..", "data"))


def readable(path):
    try:
        with gzip.open(path, "rb") as f:
            while f.read(1 << 20):
                pass
        return True
    except EOFError:
        return True                                  # only the last member is cut off: readers handle that
    except (OSError, zlib.error):
        return False


def recover(path):
    """Complete lines from every gzip member, found by scanning for gzip headers."""
    raw = open(path, "rb").read()
    starts, k = [], raw.find(b"\x1f\x8b\x08")
    while k >= 0:
        starts.append(k); k = raw.find(b"\x1f\x8b\x08", k + 1)
    lines, i = [], 0
    while i < len(starts):
        d, out, pos = zlib.decompressobj(31), [], starts[i]
        while pos < len(raw) and not d.eof:          # in chunks, so a cut-off member keeps what precedes the cut
            chunk = raw[pos:pos + 65536]
            try:
                out.append(d.decompress(chunk))
            except zlib.error:
                break
            pos += len(chunk)
        for l in b"".join(out).split(b"\n")[:-1]:    # the last piece may be a partial line
            try:
                json.loads(l); lines.append(l)
            except ValueError:
                pass                                 # garbage from a false header inside compressed data
        if d.eof:
            end = pos - len(d.unused_data)
            i = next((j for j, s in enumerate(starts) if s >= end), len(starts))
        else:
            i += 1
    return lines


def main():
    files = sys.argv[1:] or sorted(glob.glob(os.path.join(DATA, "*", "events-*.jsonl.gz")))
    for p in files:
        if readable(p):
            continue
        lines = recover(p)
        os.makedirs(os.path.join(DATA, "broken"), exist_ok=True)
        shutil.copy2(p, os.path.join(DATA, "broken", os.path.basename(os.path.dirname(p)) + "_" + os.path.basename(p)))
        tmp = p + ".tmp"
        with gzip.open(tmp, "wb", compresslevel=6) as f:
            f.write(b"\n".join(lines) + b"\n")
        os.replace(tmp, p)
        print(f"repaired {p}: {len(lines)} lines recovered (original kept in data/broken/)")


if __name__ == "__main__":
    main()
