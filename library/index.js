import { $PWA } from "./pwa.core.js";

//Пример подтверждение обновления

$PWA.update.addEventListener('message', ({ data: { type } }) => {
    if (type === 'INSTALL_PERMISSION_REQUEST') {
        $PWA.update.postMessage({ type: 'INSTALL_RECEIVED' });
    }
});