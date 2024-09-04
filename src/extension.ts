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
import { Explorer } from './explorer';
import { Cache } from './cache';
import { Preferences } from './preferences';

let provider: extensionApi.ImageFilesProvider;

export async function activate(extensionContext: extensionApi.ExtensionContext): Promise<void> {
  const preferences = new Preferences();
  preferences.init();
  const cache = new Cache(preferences, extensionContext.storagePath);
  await cache.init();
  const explorer = new Explorer(cache);

  provider = extensionApi.provider.createImageFilesProvider({
    getFilesystemLayers: explorer.getFilesystemLayers.bind(explorer),
  });
  explorer.setProvider(provider);
  extensionContext.subscriptions.push(provider);

  const eventListener = extensionApi.containerEngine.onEvent(async (event: extensionApi.ContainerJSONEvent) => {
    if (event.Type === 'image' && event.status === 'delete') {
      await cache.clearImageCache(event.id);
    }
  });
  extensionContext.subscriptions.push(eventListener);
}

export function deactivate(): void {
  console.log('stopping layers-explorer extension');
}
