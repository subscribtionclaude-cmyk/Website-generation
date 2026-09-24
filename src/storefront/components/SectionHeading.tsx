import { ArrowRight } from 'lucide-react';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import styles from './catalog.module.css';

export function SectionHeading({
  id,
  eyebrow,
  title,
  subtitle,
  link,
  level = 2,
}: {
  id: string;
  eyebrow?: string | null;
  title: string;
  subtitle?: string | null;
  link?: { label: string; href: string } | null;
  level?: 1 | 2;
}) {
  const Heading = `h${level}` as const;
  return (
    <div className={styles.sectionHead}>
      <div className={styles.sectionHeadText}>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <Heading id={id} className={styles.sectionTitle}>
          {title}
        </Heading>
        {subtitle && <p className={styles.sectionSubtitle}>{subtitle}</p>}
      </div>
      {link && (
        <LocaleLink to={link.href} className={styles.sectionLink}>
          {link.label}
          <ArrowRight className="flip-rtl" aria-hidden="true" />
        </LocaleLink>
      )}
    </div>
  );
}
