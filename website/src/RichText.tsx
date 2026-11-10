import { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import './richText.css';
import { Block, ImageStyle, InlineNode, parseDocument, parseInline, readHeadingLine, TextStyle } from './richFormat';

/**
 * Renders the website's page and guide text (see richFormat.ts for the format).
 * Everything becomes React nodes, so stored text can never inject HTML.
 * The staff app's page editor uses renderBlock for its live preview, so the
 * preview is drawn by exactly this code and richText.css.
 */

function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.t) {
      case 'text':
        return node.v;
      case 'b':
        return <strong key={i}>{renderInline(node.c)}</strong>;
      case 'i':
        return <em key={i}>{renderInline(node.c)}</em>;
      case 's':
        return <s key={i}>{renderInline(node.c)}</s>;
      case 'mark':
        return <mark key={i}>{renderInline(node.c)}</mark>;
      case 'a': {
        const external = node.href.startsWith('https://');
        return (
          <a key={i} href={node.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {renderInline(node.c)}
          </a>
        );
      }
    }
  });
}

export const inline = (text: string): ReactNode[] => renderInline(parseInline(text));

/** Class names for a text block's style tag. */
export function textStyleClass(style: TextStyle): string {
  return [
    style.align && `rt-align-${style.align}`,
    style.size && `rt-size-${style.size}`,
    style.font && `rt-font-${style.font}`,
    style.color && `rt-color-${style.color}`,
    style.box && `rt-box rt-box-${style.box}`,
  ]
    .filter(Boolean)
    .join(' ');
}

const RATIO_CSS = (ratio: ImageStyle['ratio']) => (ratio === 'auto' ? undefined : ratio.replace(':', ' / '));

export function imageCss(style: ImageStyle): { frame: CSSProperties; img: CSSProperties } {
  const position = `${style.x}% ${style.y}%`;
  return {
    frame: { aspectRatio: RATIO_CSS(style.ratio) },
    img: {
      objectPosition: position,
      transformOrigin: position,
      transform: style.zoom > 1 ? `scale(${style.zoom})` : undefined,
    },
  };
}

export interface RenderOptions {
  /** Extra props for the block's outer element (the preview uses these to select blocks). */
  props?: HTMLAttributes<HTMLElement> & { [data: `data-${string}`]: string | number | undefined };
  /** Drawn inside a photo's frame, on top of the photo (the preview's handles). */
  frameExtra?: ReactNode;
  /** Page sections: "## " headings drawn at the size the info pages use. */
  sectionHeadings?: boolean;
}

export function renderBlock(block: Block, key: number | string, options: RenderOptions = {}): ReactNode {
  const { props = {}, frameExtra, sectionHeadings } = options;
  const join = (...names: (string | false | undefined)[]) =>
    [...names, props.className].filter(Boolean).join(' ');
  const rest = { ...props, className: undefined };

  switch (block.type) {
    case 'hr':
      return <hr key={key} {...rest} className={join('rt-hr')} />;

    case 'img': {
      const { style } = block;
      const css = imageCss(style);
      const floated = style.width !== 'full' && style.align !== 'center';
      return (
        <figure
          key={key}
          {...rest}
          className={join('rt-figure', `rt-w-${style.width}`, floated ? `rt-float-${style.align}` : 'rt-center')}
        >
          <div className="rt-frame" style={css.frame}>
            <img
              src={block.src}
              alt={block.alt}
              loading="lazy"
              decoding="async"
              draggable={false}
              className={style.ratio === 'auto' ? 'rt-img-natural' : 'rt-img-cover'}
              style={css.img}
            />
            {frameExtra}
          </div>
          {block.caption && <figcaption>{inline(block.caption)}</figcaption>}
        </figure>
      );
    }

    case 'ul':
    case 'ol': {
      const items = block.items.map((item, i) => <li key={i}>{inline(item)}</li>);
      const className = join('rt-list', textStyleClass(block.style));
      return block.type === 'ol'
        ? <ol key={key} {...rest} className={className}>{items}</ol>
        : <ul key={key} {...rest} className={className}>{items}</ul>;
    }

    case 'h2':
      return (
        <h2 key={key} {...rest} className={join(sectionHeadings ? 'rt-h2 rt-section' : 'rt-h2', textStyleClass(block.style))}>
          {inline(block.text)}
        </h2>
      );
    case 'h3':
      return <h3 key={key} {...rest} className={join('rt-h3', textStyleClass(block.style))}>{inline(block.text)}</h3>;
    case 'quote':
      return <blockquote key={key} {...rest} className={join('rt-quote', textStyleClass(block.style))}>{inline(block.text)}</blockquote>;
    case 'p':
      return <p key={key} {...rest} className={join(textStyleClass(block.style))}>{inline(block.text)}</p>;
  }
}

export function RichText({ body, className = '' }: { body: string; className?: string }) {
  return <div className={`rich-text ${className}`}>{parseDocument(body).map((block, i) => renderBlock(block, i))}</div>;
}

/** Splits text at "## " headings, for pages shown as sections or questions. */
export function splitSections(body: string): { heading: string; headingStyle: TextStyle; body: string }[] {
  const sections: { heading: string; headingStyle: TextStyle; body: string }[] = [];
  for (const raw of body.split('\n')) {
    const heading = readHeadingLine(raw);
    if (heading) sections.push({ heading: heading.text, headingStyle: heading.style, body: '' });
    else if (sections.length) sections[sections.length - 1].body += `${raw}\n`;
    else if (raw.trim()) sections.push({ heading: '', headingStyle: {}, body: `${raw}\n` });
  }
  return sections;
}

export { plainText } from './richFormat';
