// General milk-care guides staff can add as drafts, then review and publish from the Online Store screen.
export interface StarterGuide {
  slug: string;
  title: string;
  category: string;
  summary: string;
  body: string;
}

export const STARTER_GUIDES: StarterGuide[] = [
  {
    slug: 'how-to-store-fresh-milk',
    title: 'How to store fresh milk',
    category: 'Storage',
    summary: 'Keep milk cold, covered and clean so it stays fresh for longer.',
    body: `## Keep it cold
Store milk in the fridge at 4°C or below. Put it back as soon as you have poured what you need.
Keep it on a shelf towards the back of the fridge. The door is the warmest part because it opens so often.

## Keep it covered
Milk picks up smells from other food, so keep the lid or cover on.

## Keep it clean
- Use clean, dry containers and utensils.
- Never pour leftover milk back into the main container.
- Wash reusable containers with hot, soapy water and let them dry fully.

## Use it in time
Follow the date on the pack if there is one. Once a pack is open, use it within a few days, and always check the milk before you use it.`,
  },
  {
    slug: 'should-you-boil-your-milk',
    title: 'Should you boil your milk?',
    category: 'Handling',
    summary: 'When milk needs boiling, and how to do it safely.',
    body: `## When to boil
Always boil raw milk, meaning milk that has not been pasteurised, before you drink it. Boiling kills harmful germs.
Pasteurised milk has already been heat-treated, so it does not need boiling if it has been kept cold. You can still warm it for tea or porridge.

## How to boil milk
- Use a clean, heavy-based pot.
- Heat it over medium heat and stir now and then so it doesn't burn at the bottom.
- Let it come to a full, rolling boil, then take it off the heat. Watch closely, because milk can rise and spill quickly.

## After boiling
Cover the milk and let it cool quickly. Refrigerate it once it has cooled, and use it soon. Boiling does not make milk last forever, and it can still go off.`,
  },
  {
    slug: 'how-to-tell-if-milk-has-gone-off',
    title: 'How to tell if milk has gone off',
    category: 'Safety',
    summary: 'Simple signs that milk is no longer good to use.',
    body: `## Check before you use it
- Smell: fresh milk smells clean and mild. A sour or unpleasant smell means it has turned.
- Look: lumps, thick clots or a yellow colour are warning signs.
- Heat: if milk curdles when you warm it, don't use it.

## If you are not sure
Throw it away. It is not worth the risk, and don't taste milk that already smells or looks wrong.

## What about mala and yoghurt?
Fermented products such as mala and yoghurt are meant to be thick and tangy. Throw them away if you see mould, gas or a swollen pack, or if the smell is unusual or the date has passed.`,
  },
  {
    slug: 'keeping-milk-without-a-fridge',
    title: 'Keeping milk without a fridge',
    category: 'Storage',
    summary: 'What to do when you do not have cold storage.',
    body: `Milk spoils quickly in warm temperatures, so buy what you can use soon. These steps help when you have no fridge.

## What helps
- Boil the milk as soon as you get it home.
- Cover it and keep it in the coolest, shadiest place you have.
- Boil it again before using it if some hours have passed.
- Use it the same day.

## Sealed long-life milk
Long-life (UHT) milk stays good unopened at room temperature until its date. Once opened, treat it like fresh milk.

## What to avoid
- Don't leave milk in direct sun or a closed, hot room.
- Don't mix old milk with new milk.
- Don't use milk that has been left out overnight without checking it first, and if in doubt, throw it away.`,
  },
];
