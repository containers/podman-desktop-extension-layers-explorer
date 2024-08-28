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

import type { ImageFilesystemLayers, ImageInfo } from '@podman-desktop/api';
import { mkdir, readdir, readFile, rm, utimes, writeFile } from 'fs/promises';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';
import type { Preferences } from './preferences';
import { statSync } from 'node:fs';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface CacheFileInfo {
  name: string;
  size: number;
}

export class Cache {
  constructor(
    private preferences: Preferences,
    private path: string,
  ) {}

  public async init() {
    try {
      await this.limitSize(0);
    } catch (err: unknown) {
      console.warn(`error clearing cache: ${err}`);
    }
  }

  // Returns the cached data for an image
  // or undefined if the data is not cached for this image
  // If data is cached, modify the access time of the file
  public async get(image: ImageInfo): Promise<ImageFilesystemLayers | undefined> {
    try {
      const filepath = this.getImageCacheFile(image);
      const compressed = await readFile(filepath);
      try {
        await utimes(filepath, new Date(), new Date());
      } catch (err: unknown) {
        console.warn(`unable to modify atime and mtime for ${image.Id} cache file: ${err}`);
      }
      const content = await gunzip(compressed);
      return JSON.parse(content.toString());
    } catch (error: unknown) {
      if (this.isErrorWithCode(error) && error.code === 'ENOENT') {
        return undefined;
      } else {
        console.warn(`error getting/reading cache for ${image.Id}: ${error}`);
        return undefined;
      }
    }
  }

  // cache data for an image and removes older cache files to remain in the cache size limit
  public async save(image: ImageInfo, layers: ImageFilesystemLayers): Promise<void> {
    try {
      const compressed = await gzip(JSON.stringify(layers));
      await this.limitSize(compressed.length);
      if (compressed.length <= 1024 * 1024 * this.preferences.getCacheSize()) {
        const filepath = this.getImageCacheFile(image);
        const basedir = path.dirname(filepath);
        await mkdir(basedir, { recursive: true });
        await writeFile(filepath, compressed);
      }
    } catch (err: unknown) {
      console.warn(`error saving cache file for ${image.Id}`);
    }
  }

  // Remove older files to limit the size to the cache
  // reserved is the amount of space to remove from the cache limit
  // to keep the place for a new file to be wriiten
  public async limitSize(reserved: number): Promise<void> {
    const rootdir = this.getRootDir();
    const files = await this.getSortedFilesByAtime(rootdir);
    const max = 1024 * 1024 * this.preferences.getCacheSize();
    let acc = reserved;
    for (const file of files) {
      if (acc + file.size > max) {
        await this.deleteCacheFile(file.name);
        continue;
      }
      acc += file.size;
    }
  }

  public async clearImageCache(id: string): Promise<void> {
    return this.deleteCacheFile(`sha256:${id}.gz`);
  }

  public async deleteCacheFile(filename: string): Promise<void> {
    await rm(path.join(this.getRootDir(), filename));
  }

  private getRootDir(): string {
    return path.join(this.path, 'cache', 'v1');
  }

  private getImageCacheFile(image: ImageInfo): string {
    return path.join(this.getRootDir(), image.Id + '.gz');
  }

  private isErrorWithCode(err: unknown): err is Error & { code: unknown } {
    return err instanceof Error && 'code' in err;
  }

  // returns the list of cache files, sorted by access time, last accessed first
  public async getSortedFilesByAtime(dir: string): Promise<CacheFileInfo[]> {
    try {
      const files = await readdir(dir);
      return files
        .map(fileName => {
          const stats = statSync(`${dir}/${fileName}`);
          return {
            name: fileName,
            atime: stats.atime.getTime(),
            size: stats.size,
          };
        })
        .sort((a, b) => b.atime - a.atime)
        .map(file => ({
          name: file.name,
          size: file.size,
        }));
    } catch (err: unknown) {
      if (this.isErrorWithCode(err) && err.code === 'ENOENT') {
        return [];
      } else {
        console.warn('error getting files in layers cache');
        return [];
      }
    }
  }
}
