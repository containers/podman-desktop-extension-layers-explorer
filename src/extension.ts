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

import * as extensionApi from '@podman-desktop/api';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as nodeTar from 'tar';

const WHITEOUT_MARKER = '.wh.';
const OPAQUE_WHITEOUT_MARKER = '.wh..wh..opq';

let provider: extensionApi.ImageFilesProvider;

export async function activate(extensionContext: extensionApi.ExtensionContext): Promise<void> {
  provider = extensionApi.provider.createImageFilesProvider({
    getFilesystemLayers: getFilesystemLayers,
  });
  extensionContext.subscriptions.push(provider);
}

export function deactivate(): void {
  console.log('stopping layers-explorer extension');
}

async function getFilesystemLayers(
  image: extensionApi.ImageInfo,
  token?: extensionApi.CancellationToken,
): Promise<extensionApi.ImageFilesystemLayers> {
  const tmpdir = await mkdtemp(path.join(os.tmpdir(), 'podman-desktop'));
  try {
    const tarFile = path.join(tmpdir, image.Id + '.tar');
    await extensionApi.containerEngine.saveImage(image.engineId, image.Id, tarFile, token);
    await nodeTar.extract({ file: tarFile, cwd: tmpdir });
    return await getLayersFromImageArchive(tmpdir);
  } catch (e: unknown) {
    console.error('error extracting image layers', e);
  } finally {
    rm(tmpdir, { force: true, recursive: true }).catch((err: unknown) => {
      console.error(`unable to delete directory ${tmpdir}: ${String(err)}`);
    });
  }
}

interface History {
  created_by?: string;
  empty_layer?: boolean;
}

async function getLayersFromImageArchive(tmpdir: string): Promise<extensionApi.ImageFilesystemLayers> {
  const fileContent = await readFile(path.join(tmpdir, 'manifest.json'), 'utf-8');
  const manifest = JSON.parse(fileContent);
  if (manifest.length < 1) {
    return {
      layers: [],
    };
  }
  const layers: string[] = manifest[0].Layers;

  const configFile = manifest[0].Config;
  const config = JSON.parse(await readFile(path.join(tmpdir, configFile), 'utf-8'));
  const history: History[] = config.history;
  const layersResult: extensionApi.ImageFilesystemLayer[] = [];
  for (const layer of layers) {
    const currentLayer: extensionApi.ImageFilesystemLayer = {
      id: layer.substring(0, 12),
    };
    const layerTar = path.join(tmpdir, layer);
    await nodeTar.list({
      file: layerTar,
      onentry: (entry: nodeTar.ReadEntry) => {
        if (isWhiteout(entry.path)) {
          if (isOpaqueWhiteout(entry.path)) {
            provider.addOpaqueWhiteout(currentLayer, path.dirname(entry.path));
          } else {
            provider.addWhiteout(currentLayer, getHiddenFile(entry.path));
          }
        } else if (entry.type === 'Directory') {
          provider.addDirectory(currentLayer, {
            path: entry.path,
            mode: entry.mode,
          });
        } else if (entry.type === 'SymbolicLink') {
          provider.addSymlink(currentLayer, {
            path: entry.path,
            mode: entry.mode,
            linkPath: entry.linkpath,
          });
        } else {
          provider.addFile(currentLayer, {
            path: entry.path,
            mode: entry.mode,
            size: entry.size,
          });
        }
      },
    });
    layersResult.push(currentLayer);
  }

  let i = layersResult.length - 1;
  for (const histo of history.slice().reverse()) {
    if (histo.empty_layer) {
      continue;
    }
    layersResult[i--].createdBy = histo.created_by;
  }

  return {
    layers: layersResult,
  };
}

function isWhiteout(p: string): boolean {
  const basename = path.basename(p);
  if (basename.startsWith(WHITEOUT_MARKER)) {
    return true;
  }
}

function isOpaqueWhiteout(p: string): boolean {
  const basename = path.basename(p);
  if (basename === OPAQUE_WHITEOUT_MARKER) {
    return true;
  }
}

function getHiddenFile(p: string): string {
  if (!isWhiteout(p)) {
    throw `${p} is not a whiteout`;
  }
  const dirname = path.dirname(p);
  const basename = path.basename(p);
  const realBasename = basename.substring(WHITEOUT_MARKER.length);
  return path.join(dirname, realBasename);
}
