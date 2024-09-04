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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheFileInfo } from './cache';
import { Cache } from './cache';
import type { Preferences } from './preferences';
import type { ImageInfo } from '@podman-desktop/api';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';

const mocks = vi.hoisted(() => ({
  consoleWarnMock: vi.fn(),
  fsReadFile: vi.fn(),
  fsUtimes: vi.fn(),
  fsReaddir: vi.fn(),
  fsStatSync: vi.fn(),
  fsWriteFile: vi.fn(),
  fsMkdir: vi.fn(),
}));

vi.mock('fs/promises', async () => {
  return {
    readFile: mocks.fsReadFile,
    utimes: mocks.fsUtimes,
    readdir: mocks.fsReaddir,
    writeFile: mocks.fsWriteFile,
    mkdir: mocks.fsMkdir,
  };
});

vi.mock('fs', async () => {
  return {
    statSync: mocks.fsStatSync,
  };
});

const originalConsoleWarn = console.warn;

const gzip = promisify(zlib.gzip);

describe('cache', () => {
  let cache: Cache;
  let preferences: Preferences;

  beforeEach(async () => {
    vi.clearAllMocks();
    console.warn = mocks.consoleWarnMock;
    preferences = {
      getCacheSize: () => 1,
    } as Preferences;
    cache = new Cache(preferences, '/path/to/extension');
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  it('get should use an exising and correct cache file', async () => {
    const content = `{ 
  "layers": [
    {
      "createdBy" : "/bin/sh -c #(nop) ADD file:4aa9ddc52f046592777767c91a04b9490d98811bedb8980fca794d55bbad1a0f in / ",
      "files" : [
        {
            "atime" : "2024-08-27T14:39:24.711Z",
            "ctime" : "2024-08-27T14:39:24.711Z",
            "gid" : 1,
            "linkPath" : "usr/bin",
            "mode" : 511,
            "mtime" : "2024-08-27T14:39:24.711Z",
            "path" : "bin",
            "size" : 0,
            "type" : "symlink",
            "uid" : 1
        }
      ] 
    }
  ]
}`;
    const zipped = await gzip(content);
    mocks.fsReadFile.mockResolvedValue(zipped);
    const result = await cache.get({ Id: '1' } as ImageInfo);
    expect(result?.layers).toBeDefined();
    expect(result?.layers.length).toBe(1);
    expect(result?.layers[0].files).toBeDefined();
    expect(result?.layers[0].files?.length).toBe(1);
    expect(mocks.consoleWarnMock).not.toHaveBeenCalled();
  });

  it('get should use an exising and correct cache file even if utimes fails', async () => {
    const content = `{ 
  "layers": [
    {
      "createdBy" : "/bin/sh -c #(nop) ADD file:4aa9ddc52f046592777767c91a04b9490d98811bedb8980fca794d55bbad1a0f in / ",
      "files" : [
        {
            "atime" : "2024-08-27T14:39:24.711Z",
            "ctime" : "2024-08-27T14:39:24.711Z",
            "gid" : 1,
            "linkPath" : "usr/bin",
            "mode" : 511,
            "mtime" : "2024-08-27T14:39:24.711Z",
            "path" : "bin",
            "size" : 0,
            "type" : "symlink",
            "uid" : 1
        }
      ] 
    }
  ]
}`;
    const zipped = await gzip(content);
    mocks.fsReadFile.mockResolvedValue(zipped);
    mocks.fsUtimes.mockRejectedValue(new Error('an error'));
    const result = await cache.get({ Id: '1' } as ImageInfo);
    expect(result?.layers).toBeDefined();
    expect(result?.layers.length).toBe(1);
    expect(result?.layers[0].files).toBeDefined();
    expect(result?.layers[0].files?.length).toBe(1);
    expect(mocks.consoleWarnMock).toHaveBeenCalledWith(
      'unable to modify atime and mtime for 1 cache file: Error: an error',
    );
  });

  it('get should fail with an exising but incorrect cache file', async () => {
    const content = `{ 
  "layers": [
    {
      "createdBy" : "/bin/sh -c #(nop) ADD file:4aa9ddc52f046592777767c91a04b9490d98811bedb8980fca794d55bbad1a0f in / ",
      "files" : [
        {
            "atime" : "2024-08-27T14:39:24.711Z",
            "ctime" : "2024-08-27T14:39:24.711Z",
            "gid" : 1,
            "linkPath" : "usr/bin",
            "mode" : 511,
            "mtime" : "2024-08-27T14:39:24.711Z",
            "path" : "bin",
            "size" : 0,
            "type" : "symlink",
            "uid" : 1
        }
      ] 
    }
  ]
}`;
    // the cache file is not zipped
    mocks.fsReadFile.mockResolvedValue(content);
    const result = await cache.get({ Id: '1' } as ImageInfo);
    expect(result).not.toBeDefined();
    expect(mocks.consoleWarnMock).toHaveBeenCalledWith(
      'error getting/reading cache for 1: Error: incorrect header check',
    );
  });

  it('get should return undefined if no cache exists', async () => {
    // the cache file does not exist
    const err: Error & { code?: string } = new Error('not found');
    err.code = 'ENOENT';
    mocks.fsReadFile.mockRejectedValue(err);
    const result = await cache.get({ Id: '1' } as ImageInfo);
    expect(result).not.toBeDefined();
    expect(mocks.consoleWarnMock).not.toHaveBeenCalled();
  });

  it('limitSize should not delete cache file when there is enough room', async () => {
    const files: CacheFileInfo[] = [
      {
        name: '1.gz',
        size: 300000,
      },
      {
        name: '2.gz',
        size: 300000,
      },
      {
        name: '1.gz',
        size: 300000,
      },
    ];
    const getSortedFilesByAtimeMock = vi.spyOn(cache, 'getSortedFilesByAtime');
    const deleteCacheFileMock = vi.spyOn(cache, 'deleteCacheFile');
    getSortedFilesByAtimeMock.mockResolvedValue(files);
    await cache.limitSize(0);
    expect(deleteCacheFileMock).not.toHaveBeenCalled();
  });

  it('limitSize should delete oldest cache file when there is no enough room', async () => {
    const files: CacheFileInfo[] = [
      {
        name: '1.gz',
        size: 300000,
      },
      {
        name: '2.gz',
        size: 300000,
      },
      {
        name: '3.gz',
        size: 300000,
      },
    ];
    const getSortedFilesByAtimeMock = vi.spyOn(cache, 'getSortedFilesByAtime');
    const deleteCacheFileMock = vi.spyOn(cache, 'deleteCacheFile');
    deleteCacheFileMock.mockResolvedValue();
    getSortedFilesByAtimeMock.mockResolvedValue(files);
    await cache.limitSize(300000);
    expect(deleteCacheFileMock).toHaveBeenCalledOnce();
    expect(deleteCacheFileMock).toHaveBeenCalledWith('3.gz');
  });

  it('limitSize should delete old cache file when there is no enough room, but keep small older ones', async () => {
    // here, 3 and 6 are removed, but 4 and 5 are kept
    const files: CacheFileInfo[] = [
      {
        name: '1.gz',
        size: 300000,
      },
      {
        name: '2.gz',
        size: 300000,
      },
      {
        name: '3.gz',
        size: 300000,
      },
      {
        name: '4.gz',
        size: 30,
      },
      {
        name: '5.gz',
        size: 30,
      },
      {
        name: '6.gz',
        size: 300000,
      },
    ];
    const getSortedFilesByAtimeMock = vi.spyOn(cache, 'getSortedFilesByAtime');
    const deleteCacheFileMock = vi.spyOn(cache, 'deleteCacheFile');
    deleteCacheFileMock.mockResolvedValue();
    getSortedFilesByAtimeMock.mockResolvedValue(files);
    await cache.limitSize(300000);
    expect(deleteCacheFileMock).toHaveBeenCalledTimes(2);
    expect(deleteCacheFileMock).toHaveBeenCalledWith('3.gz');
    expect(deleteCacheFileMock).toHaveBeenCalledWith('6.gz');
  });

  it('getSortedFilesByAtime should return the list of cache files, more recently accessed first', async () => {
    mocks.fsReaddir.mockResolvedValue(['1.gz', '2.gz', '3.gz']);
    mocks.fsStatSync.mockImplementation((file: string) => {
      const now = Date.now();
      switch (file) {
        case '/a/dir/1.gz':
          return {
            atime: new Date(now - 1 * 60 * 1000), // most recent
            size: 100000,
          };
        case '/a/dir/2.gz':
          return {
            atime: new Date(now - 3 * 60 * 1000), // oldest
            size: 200000,
          };
        case '/a/dir/3.gz':
          return {
            atime: new Date(now - 2 * 60 * 1000),
            size: 300000,
          };
      }
    });
    const files = await cache.getSortedFilesByAtime('/a/dir');
    expect(files).toEqual([
      {
        name: '1.gz',
        size: 100000,
      },
      {
        name: '3.gz',
        size: 300000,
      },
      {
        name: '2.gz',
        size: 200000,
      },
    ]);
  });

  it('save writes cache file', async () => {
    vi.spyOn(preferences, 'getCacheSize').mockReturnValue(1);
    vi.spyOn(cache, 'limitSize').mockResolvedValue();
    const layers = { layers: [] };
    await cache.save({ Id: 'sha256:1' } as ImageInfo, layers);
    const expectedContent = await gzip(JSON.stringify(layers));
    expect(mocks.fsMkdir).toHaveBeenCalledWith('/path/to/extension/cache/v1', { recursive: true });
    expect(mocks.fsWriteFile).toHaveBeenCalledWith('/path/to/extension/cache/v1/1.gz', expectedContent);
  });

  it('save does not write cache file if cache size is 0', async () => {
    vi.spyOn(preferences, 'getCacheSize').mockReturnValue(0);
    vi.spyOn(cache, 'limitSize').mockResolvedValue();
    await cache.save({ Id: 'sha256:1' } as ImageInfo, { layers: [] });
    expect(mocks.fsWriteFile).not.toHaveBeenCalled();
  });
});
