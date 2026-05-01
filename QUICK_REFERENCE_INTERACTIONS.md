# Quick Reference: Hover Effects & Visual Assets

## Button Variants & Their Hover Behavior

### Default (Primary)
```tsx
<Button size="lg" onClick={() => handleAction()}>
  Action
</Button>
```
**Hover**: Shadow elevation + 85% background + lift (-translate-y-1)

### Outline (Secondary)
```tsx
<Button variant="outline" size="lg">
  Secondary Action
</Button>
```
**Hover**: Border accent + background secondary/50 + shadow

### Ghost (Minimal)
```tsx
<Button variant="ghost">
  Subtle
</Button>
```
**Hover**: Accent background (10% opacity) only

### Link
```tsx
<Button variant="link">
  Click Here
</Button>
```
**Hover**: Text darkens + underline appears

## Common Patterns

### CTA with Icon
```tsx
<Button size="lg" className="shadow-lg shadow-primary/30">
  Get Started
  <ArrowRight size={18} className="ml-2" />
</Button>
```

### Filter Button
```tsx
<Button
  variant={isActive ? 'default' : 'outline'}
  className={`transition-all ${isActive ? 'scale-105' : ''}`}
  onClick={() => setActive(!isActive)}
>
  Filter
</Button>
```

### Card with Hover
```tsx
<div className="bg-card border border-border/60 hover:border-primary/40 hover:shadow-lg hover:-translate-y-2 transition-all duration-300 group">
  <h3 className="group-hover:text-primary">Title</h3>
</div>
```

## Visual Assets Locations

| Image | Path | Best For |
|-------|------|----------|
| Hero Workspace | `/images/hero-creative-workspace.jpg` | Landing page, hero sections |
| Collaboration | `/images/collaboration-teamwork.jpg` | Team features, about page |
| Success | `/images/success-celebration.jpg` | Achievement sections |
| Global Network | `/images/global-network.jpg` | Global reach, network messaging |
| Portfolio | `/images/portfolio-showcase.jpg` | Portfolio features, galleries |

## Component Quick Access

### Gallery Component
```tsx
import { FeatureGallery } from '@/components/feature-gallery';

<FeatureGallery items={items} columns={2} />
```

### Hero Banner
```tsx
import { HeroBanner } from '@/components/hero-banner';

<HeroBanner />
```

## Transition Classes

| Duration | Class | Use Case |
|----------|-------|----------|
| Fast | `transition-smooth-fast` | Icon animations |
| Normal | `transition-smooth` | Hover states (default) |
| Slow | `transition-smooth-slow` | Entrance animations |

## Hover Effect Timing

- **200ms**: Button hovers, small state changes
- **300ms**: Card hover, feature reveal
- **500ms**: Image zoom, large transitions

## Dark Mode Handling

All colors automatically adjust:
- Light: Indigo primary, cyan accent
- Dark: Bright indigo, bright cyan

No special styling needed - CSS variables handle it!

## Mobile Considerations

- All hover effects work on touch (triggered by tap)
- Scale transforms optimize for touch devices
- Buttons have minimum 44px height for accessibility
- Responsive padding on all sizes

## Testing Checklist

- [ ] Test hover on desktop
- [ ] Test tap on mobile
- [ ] Test dark mode toggle
- [ ] Test keyboard navigation (Tab key)
- [ ] Test focus states
- [ ] Check performance (no jank)

## Common Mistakes to Avoid

❌ Don't use `hover:bg-color` without transition
✅ Always include transition class

❌ Don't forget `group` class for child hover effects
✅ Use `group-hover:` for child element animations

❌ Don't use multiple animation durations inconsistently
✅ Stick to 200ms, 300ms, or 500ms

❌ Don't forget dark mode testing
✅ Test all effects in both modes
