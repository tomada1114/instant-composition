export function storedZip(files: Record<string, Buffer>): Buffer {
  const local: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const [name, bytes] of Object.entries(files)) {
    const text = Buffer.from(name),
      header = Buffer.alloc(30),
      central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(text.length, 26);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(text.length, 28);
    central.writeUInt32LE(offset, 42);
    local.push(header, text, bytes);
    directory.push(central, text);
    offset += header.length + text.length + bytes.length;
  }
  const index = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}
