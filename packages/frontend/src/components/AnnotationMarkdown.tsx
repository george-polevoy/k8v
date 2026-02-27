import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface AnnotationMarkdownProps {
  markdown: string;
  color: string;
  fontSize: number;
}

function AnnotationMarkdown({ markdown, color, fontSize }: AnnotationMarkdownProps) {
  return (
    <div className="annotation-markdown" style={{ color, fontSize: `${fontSize}px` }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export default AnnotationMarkdown;
