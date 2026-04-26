'use client';

import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/components/i18n-provider';
import { LOCALE_INFO, SUPPORTED_LOCALES, type AppLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const touchIconButtonClass =
  'min-h-11 min-w-11 shrink-0 touch-manipulation md:h-9 md:w-9 md:min-h-0 md:min-w-0';

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t, isLoading } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={isLoading}
          className={cn(touchIconButtonClass, className)}
          aria-label={t('languageSwitcher.aria')}
        >
          <Languages size={20} className="text-primary" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t('languageSwitcher.label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(v) => {
            if (SUPPORTED_LOCALES.includes(v as AppLocale)) {
              void setLocale(v as AppLocale);
            }
          }}
        >
          {SUPPORTED_LOCALES.map((code) => {
            const info = LOCALE_INFO[code];
            return (
              <DropdownMenuRadioItem key={code} value={code} className="cursor-pointer">
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{info.nativeLabel}</span>
                  <span className="text-xs text-muted-foreground">{info.label}</span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-xs text-muted-foreground focus:bg-transparent">
          {t('languageSwitcher.current', { name: LOCALE_INFO[locale].nativeLabel })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
