import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { Block, Manuscript } from '@quire/core';
import type { ExportOptions } from './options';
import { escapeXml, runsToXhtml } from './xml';

// Fixed timestamp on every zip entry so the same input always produces the same bytes.
const ZIP_DATE = new Date(Date.UTC(2000, 0, 1));

const STYLESHEET = `body { font-family: serif; line-height: 1.45; margin: 0 5%; }
h1 { font-size: 1.6em; text-align: center; margin: 3em 0 2em; font-weight: normal; }
h2 { font-size: 1.2em; margin: 1.5em 0 0.5em; }
h3 { font-size: 1em; font-style: italic; margin: 1.2em 0 0.4em; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
p.first, h1 + p, h2 + p, h3 + p, hr + p { text-indent: 0; }
blockquote { margin: 1em 2em; font-style: italic; }
blockquote p { text-indent: 0; }
hr.scene { border: none; margin: 1.2em 0; text-align: center; }
hr.scene::after { content: "* * *"; }
.titlepage { text-align: center; margin-top: 30%; }
.titlepage .author { margin-top: 2em; font-size: 1.1em; }
.copyright { font-size: 0.85em; margin-top: 50%; }
.copyright p, .dedication p { text-indent: 0; text-align: center; }
.dedication { margin-top: 30%; font-style: italic; }`;

function page(title: string, body: string, language: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`;
}

function blockToXhtml(block: Block): string {
  switch (block.kind) {
    case 'heading':
      return `<h${block.level}>${runsToXhtml(block.runs)}</h${block.level}>`;
    case 'paragraph':
      return `<p>${runsToXhtml(block.runs)}</p>`;
    case 'quote':
      return `<blockquote><p>${runsToXhtml(block.runs)}</p></blockquote>`;
    case 'scene-break':
      return '<hr class="scene"/>';
  }
}

export function bookIdentifier(manuscript: Manuscript, isbn: string | null): string {
  if (isbn) return `urn:isbn:${isbn.replace(/[^0-9X]/gi, '')}`;
  const hash = createHash('sha256').update(`${manuscript.title}\u0000${manuscript.author}`).digest('hex');
  return `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function exportEpub(manuscript: Manuscript, options: ExportOptions): Promise<Buffer> {
  const language = 'en';
  const zip = new JSZip();
  const add = (path: string, content: string) => zip.file(path, content, { date: ZIP_DATE });
  // The mimetype entry must be first and stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', date: ZIP_DATE });
  add(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );
  add('OEBPS/style.css', STYLESHEET);

  const title = escapeXml(manuscript.title);
  const author = escapeXml(manuscript.author);
  const documents: Array<{ id: string; href: string; title: string; inToc: boolean }> = [];

  add('OEBPS/title.xhtml', page(manuscript.title, `<section class="titlepage" epub:type="titlepage"><h1>${title}</h1><p class="author">${author}</p></section>`, language));
  documents.push({ id: 'title', href: 'title.xhtml', title: 'Title Page', inToc: false });

  const copyright = [
    `<p>Copyright © ${options.publicationYear} ${author}</p>`,
    '<p>All rights reserved.</p>',
    options.isbn ? `<p>ISBN ${escapeXml(options.isbn)}</p>` : '',
  ].join('');
  add('OEBPS/copyright.xhtml', page('Copyright', `<section class="copyright" epub:type="copyright-page">${copyright}</section>`, language));
  documents.push({ id: 'copyright', href: 'copyright.xhtml', title: 'Copyright', inToc: false });

  if (options.dedication) {
    add('OEBPS/dedication.xhtml', page('Dedication', `<section class="dedication" epub:type="dedication"><p>${escapeXml(options.dedication)}</p></section>`, language));
    documents.push({ id: 'dedication', href: 'dedication.xhtml', title: 'Dedication', inToc: false });
  }

  manuscript.chapters.forEach((chapter, index) => {
    const id = `chapter-${String(index + 1).padStart(3, '0')}`;
    const body = `<section epub:type="chapter"><h1>${escapeXml(chapter.title)}</h1>\n${chapter.blocks.map(blockToXhtml).join('\n')}</section>`;
    add(`OEBPS/${id}.xhtml`, page(chapter.title, body, language));
    documents.push({ id, href: `${id}.xhtml`, title: chapter.title, inToc: true });
  });

  if (options.aboutAuthor) {
    add('OEBPS/about.xhtml', page('About the Author', `<section epub:type="appendix"><h1>About the Author</h1><p class="first">${escapeXml(options.aboutAuthor)}</p></section>`, language));
    documents.push({ id: 'about', href: 'about.xhtml', title: 'About the Author', inToc: true });
  }

  const tocItems = documents.filter((doc) => doc.inToc);
  add(
    'OEBPS/nav.xhtml',
    page('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${tocItems.map((doc) => `<li><a href="${doc.href}">${escapeXml(doc.title)}</a></li>`).join('')}</ol></nav>
<nav epub:type="landmarks" hidden=""><ol><li><a epub:type="bodymatter" href="${tocItems[0]?.href ?? 'title.xhtml'}">Start</a></li></ol></nav>`, language),
  );
  const identifier = bookIdentifier(manuscript, options.isbn);
  add(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${identifier}"/></head>
<docTitle><text>${title}</text></docTitle>
<navMap>${tocItems.map((doc, index) => `<navPoint id="np${index + 1}" playOrder="${index + 1}"><navLabel><text>${escapeXml(doc.title)}</text></navLabel><content src="${doc.href}"/></navPoint>`).join('')}</navMap>
</ncx>`,
  );
  const modified = options.modifiedAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
  add(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${language}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${identifier}</dc:identifier>
<dc:title>${title}</dc:title>
<dc:creator>${author}</dc:creator>
<dc:language>${language}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${documents.map((doc) => `<item id="${doc.id}" href="${doc.href}" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine toc="ncx">
${documents.map((doc) => `<itemref idref="${doc.id}"/>`).join('\n')}
</spine>
</package>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
}
