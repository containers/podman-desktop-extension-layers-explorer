/**********************************************************************
 * Copyright (C) 2024 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Explorer } from './explorer';
import { containerEngine } from '@podman-desktop/api';
import { cp } from 'node:fs/promises';
import * as path from 'node:path';
import type { Cache } from './cache';

vi.mock('@podman-desktop/api', async () => {
  return {
    containerEngine: {
      saveImage: vi.fn(),
    },
  };
});

describe('getFilesystemLayers', () => {
  let explorer: Explorer;
  const provider = {
    addFile: vi.fn(),
    addDirectory: vi.fn(),
    addSymlink: vi.fn(),
    addWhiteout: vi.fn(),
    addOpaqueWhiteout: vi.fn(),
    dispose: vi.fn(),
  };
  const cacheGetMock = vi.fn();
  const cacheSaveMock = vi.fn();
  const cache = {
    get: cacheGetMock,
    save: cacheSaveMock,
  } as unknown as Cache;

  beforeEach(() => {
    explorer = new Explorer(cache);
    explorer.setProvider(provider);
    vi.resetAllMocks();
  });

  test('getFilesystemLayers without cache', async () => {
    cacheGetMock.mockResolvedValue(undefined);

    vi.mocked(containerEngine).saveImage.mockImplementation(
      async (_engineId: string, _imageId: string, tarFile: string) => {
        await cp(path.join(__dirname, '../tests/archive.tar'), tarFile);
      },
    );
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
      Labels: {},
      Containers: 1,
      Digest: '',
    });
    const layers = [
      {
        id: '8e13bc96641a',
        createdBy: 'BusyBox 1.36.1 (glibc), Debian 12',
      },
      { id: 'e4423e7382d4', createdBy: '/bin/sh -c echo -n 1 > 1.txt' },
      { id: '6f35d54b965c', createdBy: '/bin/sh -c echo -n 12 > 2.txt' },
      { id: '0cb105fbebcc', createdBy: '/bin/sh -c echo -n 123 > 3.txt' },
      { id: '651b9c981348', createdBy: '/bin/sh -c rm 2.txt' },
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

  test('getFilesystemLayers with cache', async () => {
    const layers = {
      layers: [
        {
          id: '8e13bc96641a',
          createdBy: 'BusyBox 1.36.1 (glibc), Debian 12',
        },
        { id: 'e4423e7382d4', createdBy: '/bin/sh -c echo -n 1 > 1.txt' },
        { id: '6f35d54b965c', createdBy: '/bin/sh -c echo -n 12 > 2.txt' },
        { id: '0cb105fbebcc', createdBy: '/bin/sh -c echo -n 123 > 3.txt' },
        { id: '651b9c981348', createdBy: '/bin/sh -c rm 2.txt' },
      ],
    };

    cacheGetMock.mockResolvedValue(layers);

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
      Labels: {},
      Containers: 1,
      Digest: '',
    });
    expect(result).toEqual({
      layers: layers.layers,
    });
    expect(provider.addDirectory).not.toHaveBeenCalled();
    expect(provider.addSymlink).not.toHaveBeenCalled();
    expect(provider.addFile).not.toHaveBeenCalled();
    expect(provider.addFile).not.toHaveBeenCalled();
    expect(provider.addFile).not.toHaveBeenCalled();
    expect(provider.addWhiteout).not.toHaveBeenCalled();
  });
});
