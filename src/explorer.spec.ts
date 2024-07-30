import { expect, test, vi } from "vitest";
import { Explorer } from "./explorer";
import { containerEngine } from '@podman-desktop/api';
import { cp } from "fs/promises";
import * as path from "path";

vi.mock('@podman-desktop/api', async () => {
  return {
    containerEngine: {
      saveImage: vi.fn(),
    }
  };
});

test('getFilesystemLayers', async () => {
  const provider = {
    addFile: vi.fn(),
    addDirectory: vi.fn(),
    addSymlink: vi.fn(),
    addWhiteout: vi.fn(),
    addOpaqueWhiteout: vi.fn(),
    dispose: vi.fn(),
  };
  const explorer = new Explorer();
  explorer.setProvider(provider);

  vi.mocked(containerEngine).saveImage.mockImplementation(async (_engineId: string, _imageId: string, tarFile: string) => {
    await cp(path.join(__dirname, '../tests/archive.tar'), tarFile);
  });
  const result = await explorer.getFilesystemLayers({
    engineId: '',
    engineName: '',
    Id: 'id',
    ParentId: 'parentId',
    RepoTags: [],
    Created: 1,
    Size: 1,
    VirtualSize: 1,
    SharedSize: 1,
    Labels: { },
    Containers: 1,
    Digest: '',
  });
  const layers = [
    {
      id: '8e13bc96641a',
      createdBy: 'BusyBox 1.36.1 (glibc), Debian 12'
    },
    { id: 'e4423e7382d4', createdBy: '/bin/sh -c echo -n 1 > 1.txt' },
    { id: '6f35d54b965c', createdBy: '/bin/sh -c echo -n 12 > 2.txt' },
    { id: '0cb105fbebcc', createdBy: '/bin/sh -c echo -n 123 > 3.txt' },
    { id: '651b9c981348', createdBy: '/bin/sh -c rm 2.txt' }
];
  expect(result).toEqual({
    layers,
  });
  expect(provider.addDirectory).toHaveBeenCalledWith(layers[0], {
    mode: 0o755,
    path: 'lib/',
  });
  expect(provider.addSymlink).toHaveBeenCalledWith(layers[0], {
    mode: 0o777,
    path: 'lib64',
    linkPath: 'lib',
  });
  expect(provider.addFile).toHaveBeenCalledWith(layers[1], {
    mode: 0o644,
    path: '1.txt',
    size: 1,
  });
  expect(provider.addFile).toHaveBeenCalledWith(layers[2], {
    mode: 0o644,
    path: '2.txt',
    size: 2,
  });
  expect(provider.addFile).toHaveBeenCalledWith(layers[3], {
    mode: 0o644,
    path: '3.txt',
    size: 3,
  });
  expect(provider.addWhiteout).toHaveBeenCalledWith(layers[4], '2.txt');
});
