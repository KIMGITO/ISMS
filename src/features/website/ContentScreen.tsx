// Website > Content: the home banner and advert cards (saved into the draft, shown after
// Publish) and guides (articles: each guide has its own Published switch, like a product).
import { useMemo, useState } from 'react';
import { Segmented } from '../../components/shared/Choice';
import HeroSlidesEditor from '../../components/website/HeroSlidesEditor';
import AdCardsEditor from '../../components/website/AdCardsEditor';
import { GuidesTab } from '../OnlineStoreView';
import { toPublicBrand } from '../../services/websiteBrand';
import { ScreenHeading, useSaveToDraft } from './ui';
import { useWebsiteDraft } from './useWebsiteDraft';

type Part = 'banner' | 'adverts' | 'guides';

export default function ContentScreen() {
  const [part, setPart] = useState<Part>('banner');
  const businessId = useWebsiteDraft((s) => s.businessId!);
  const doc = useWebsiteDraft((s) => s.draft!.document);
  const industry = useMemo(() => toPublicBrand(doc.brand).industry, [doc.brand]);
  const save = useSaveToDraft();

  return (
    <div className="space-y-4">
      <ScreenHeading title="Content">
        {part === 'guides'
          ? 'Guides go live on their own: switch Published on a guide to show it.'
          : 'The banner and adverts are saved to the draft. Publish to show them on the website.'}
      </ScreenHeading>
      <Segmented<Part>
        className="max-w-md"
        ariaLabel="Content"
        options={[{ id: 'banner', label: 'Home banner' }, { id: 'adverts', label: 'Adverts' }, { id: 'guides', label: 'Guides' }]}
        value={part}
        onChange={setPart}
      />
      {part === 'banner' && <HeroSlidesEditor saved={doc.heroSlides} industry={industry} onSave={(heroSlides) => save({ heroSlides }, 'Home banner')} />}
      {part === 'adverts' && <AdCardsEditor saved={doc.adCards} industry={industry} onSave={(adCards) => save({ adCards }, 'Adverts')} />}
      {part === 'guides' && <GuidesTab businessId={businessId} />}
    </div>
  );
}
