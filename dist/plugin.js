const MAGIC = 'CAKK:MEDIA:1\n';
const MAGIC_BYTES = new TextEncoder().encode(MAGIC);

function createEmptyDraftState() {
  return {
    file_name: '',
    content_type: '',
    bytes: null,
  };
}

function createElement(hostApi, type, props, children) {
  if (typeof hostApi?.createElement !== 'function') {
    throw new Error('Host API must provide createElement()');
  }

  return hostApi.createElement(type, props, children);
}

function concatBytes(left, right) {
  const next = new Uint8Array(left.length + right.length);
  next.set(left, 0);
  next.set(right, left.length);
  return next;
}

function startsWithMagic(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < MAGIC_BYTES.length) {
    return false;
  }

  for (let index = 0; index < MAGIC_BYTES.length; index += 1) {
    if (bytes[index] !== MAGIC_BYTES[index]) {
      return false;
    }
  }

  return true;
}

function findByte(bytes, value, start) {
  for (let index = start; index < bytes.length; index += 1) {
    if (bytes[index] === value) {
      return index;
    }
  }
  return -1;
}

function findHeaderDivider(bytes, start) {
  for (let index = start; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 10 && bytes[index + 1] === 10) {
      return index;
    }
  }
  return -1;
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function parseMedia(bytes) {
  if (!startsWithMagic(bytes)) {
    return null;
  }

  const decoder = new TextDecoder();
  const mimeEnd = findByte(bytes, 10, MAGIC_BYTES.length);
  if (mimeEnd < 0) {
    return null;
  }

  const nameEnd = findHeaderDivider(bytes, mimeEnd + 1);
  if (nameEnd < 0) {
    return null;
  }

  const mime = decoder.decode(bytes.slice(MAGIC_BYTES.length, mimeEnd)).trim();
  const name = decoder.decode(bytes.slice(mimeEnd + 1, nameEnd)).trim();
  const body = bytes.slice(nameEnd + 2);
  if (!mime || !body.length) {
    return null;
  }

  return {
    mime,
    name: name || 'media',
    body,
  };
}

function renderPreviewLabel(media) {
  if (media.mime.startsWith('image/')) {
    return `Фото: ${media.name}`;
  }
  if (media.mime.startsWith('video/')) {
    return `Видео: ${media.name}`;
  }
  return `Медиа: ${media.name}`;
}

function openMediaView(media) {
  const source = `data:${media.mime};base64,${bytesToBase64(media.body)}`;
  window.open(source, '_blank', 'noopener,noreferrer');
}

function normalizeDraftMedia(draft_state) {
  if (!(draft_state?.bytes instanceof Uint8Array) || draft_state.bytes.length === 0) {
    return null;
  }

  return {
    bytes: draft_state.bytes,
    content_type: String(draft_state.content_type || 'application/octet-stream'),
    file_name: String(draft_state.file_name || 'media'),
  };
}

export function createCakkPlugin(hostApi) {
  return {
    id: 'media',
    title: 'Media',
    register(registry) {
      registry.registerAttachment({
        id: 'media',
        title: 'Media',
        priority: 100,
        createDraftState() {
          return createEmptyDraftState();
        },
        renderDraftEditor({ draftState, setDraftState, disabled, close, pickFiles, readFileAsBytes }) {
          const selected_name = draftState?.file_name ? draftState.file_name : 'Файл не выбран';
          const selected_type = draftState?.content_type ? ` (${draftState.content_type})` : '';

          return createElement(hostApi, 'div', { className: 'cakk-media-attachment-editor' }, [
            createElement(hostApi, 'button', {
              type: 'button',
              disabled,
              onClick: async () => {
                const files = await pickFiles({
                  accept: 'image/*,video/*',
                  multiple: false,
                });
                const file = files[0];
                if (!file) {
                  return;
                }

                const bytes = await readFileAsBytes(file);
                setDraftState({
                  file_name: String(file.name || 'media'),
                  content_type: String(file.type || 'application/octet-stream'),
                  bytes,
                });
                close();
              },
            }, 'Выбрать файл'),
            createElement(hostApi, 'div', { className: 'cakk-media-attachment-selection' }, `${selected_name}${selected_type}`),
            createElement(hostApi, 'button', {
              type: 'button',
              disabled,
              onClick: () => {
                setDraftState(createEmptyDraftState());
              },
            }, 'Очистить'),
          ]);
        },
        async createPayload({ draftState }) {
          const media = normalizeDraftMedia(draftState);
          if (!media) {
            return null;
          }

          const header = new TextEncoder().encode(`${MAGIC}${media.content_type}\n${media.file_name}\n\n`);
          return {
            bytes: concatBytes(header, media.bytes),
            metaEntries: [
              { content_type: media.content_type },
              { file_name: media.file_name },
            ],
          };
        },
        async getPushPreview({ outbound }) {
          const media = parseMedia(outbound?.bytes);
          if (!media) {
            throw new Error('Media payload is invalid');
          }

          return renderPreviewLabel(media);
        },
      });

      const canHandle = ({ bytes }) => Boolean(parseMedia(bytes));

      registry.registerPreview({
        id: 'media',
        priority: 100,
        canHandle,
        renderPreview({ bytes }) {
          const media = parseMedia(bytes);
          return media ? renderPreviewLabel(media) : '';
        },
      });

      registry.registerMessageRender({
        id: 'media',
        priority: 100,
        canHandle,
        renderMessage({ bytes }) {
          const media = parseMedia(bytes);
          if (!media) {
            return createElement(hostApi, 'span', null, 'Media payload error');
          }

          const source = `data:${media.mime};base64,${bytesToBase64(media.body)}`;
          if (media.mime.startsWith('image/')) {
            return createElement(hostApi, 'img', {
              className: 'message-media-image',
              src: source,
              alt: media.name,
            });
          }
          if (media.mime.startsWith('video/')) {
            return createElement(hostApi, 'video', {
              className: 'message-media-video',
              src: source,
              controls: true,
              playsInline: true,
            });
          }
          return createElement(hostApi, 'a', {
            className: 'message-media-link',
            href: source,
            download: media.name,
            target: '_blank',
            rel: 'noreferrer',
          }, media.name);
        },
      });

      registry.registerMessageView({
        id: 'media',
        priority: 100,
        canHandle,
        openView({ bytes }) {
          const media = parseMedia(bytes);
          if (!media) {
            return;
          }
          openMediaView(media);
        },
      });
    },
  };
}
