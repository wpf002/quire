import Link from 'next/link';

export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="wordmark" aria-label="Quire home">
      <span className="wordmark-mark" aria-hidden />
      Quire
    </Link>
  );
}
