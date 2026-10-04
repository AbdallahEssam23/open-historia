/*! Open Historia - durable whole-file writes for the server stores (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test server/atomicWrite.test.js
//
// A stored artifact written with fs.writeFileSync(target, data) is truncated
// and then rewritten: a crash, a kill or a full disk in that window destroys
// the previous good file and leaves a torn one. A temporary sibling plus a
// rename makes the swap atomic - a reader and a crash see either the whole old
// file or the whole new one. This module is the one place that shape lives, so
// no store has to spell it out again.
//
// write-file-atomic does the temporary file, the file fsync and the rename. It
// does NOT fsync the directory that holds the new name, so a power loss right
// after the rename can still lose the entry; the directory fsync below closes
// that gap, best-effort, because Windows cannot open a directory as a file.

import fs from "fs";
import path from "path";
import writeFileAtomic from "write-file-atomic";

// Durability for the rename itself, not for the bytes already fsynced by the
// library. A platform that refuses to open a directory (Windows) still gets an
// atomic rename, so a failure here must never turn a succeeded write into a
// throw.
const fsyncDirectory = (target) => {
  let fd;
  try {
    fd = fs.openSync(path.dirname(target), "r");
  } catch {
    return;
  }
  try {
    fs.fsyncSync(fd);
  } catch {
    // EINVAL/ENOTSUP/EPERM on directories: nothing more this platform offers.
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // A close error must not fail a write that already completed its rename.
    }
  }
};

// Replace `target` with `data` atomically. `data` is a string or a Buffer, as
// fs.writeFileSync takes. The parent directory is created if missing, matching
// what every caller already arranged for itself before the write.
export const atomicWriteSync = (target, data, options = {}) => {
  // fs.writeFileSync accepts an encoding string as the third argument. Callers
  // that copied that call shape pass "utf-8", so accepting it here keeps the
  // helper a drop-in and stops the value being spread into per-character keys.
  const normalized = typeof options === "string" ? { encoding: options } : options;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeFileAtomic.sync(target, data, { fsync: true, ...normalized });
  fsyncDirectory(target);
};

// Create `target` only if it does not exist - the one O_EXCL write this server
// makes (the import counter's once-per-install marker). A temp-and-rename would
// overwrite an existing marker and defeat the dedupe, so this stays a single
// exclusive create and lives here as the sanctioned raw write.
export const atomicExclusiveWriteSync = (target, data) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data, { flag: "wx" });
};
