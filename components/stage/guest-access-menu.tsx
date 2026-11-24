'use client';

import { Check, Copy, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/lib/hooks/use-i18n';
import { fetchStageMeta } from '@/lib/classroom/stage-meta-client';
import type { GuestPermissions } from '@/lib/persistence/stage-meta';

interface GuestAccessSubmenuProps {
  stageId: string | undefined;
  isOwner: boolean;
  canExport: boolean;
}

const PERMISSION_ITEMS = [
  ['guestQuiz', 'quiz'],
  ['guestTts', 'tts'],
  ['guestChat', 'chat'],
  ['guestPbl', 'pbl'],
  ['guestLocalRecords', 'localRecords'],
] as const;

/**
 * The download menu's "visitor access" submenu: sharing publishes the course,
 * and each checkbox narrows what an anonymous visitor may do inside it.
 */
export function GuestAccessSubmenu({ stageId, isOwner, canExport }: GuestAccessSubmenuProps) {
  const { t } = useI18n();
  const [permissions, setPermissions] = useState<GuestPermissions | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!stageId || !isOwner) return;
    let cancelled = false;
    void fetchStageMeta(stageId).then((result) => {
      if (cancelled || result.outcome !== 'found') return;
      setPermissions({
        guestQuiz: result.meta.guestQuiz,
        guestTts: result.meta.guestTts,
        guestChat: result.meta.guestChat,
        guestPbl: result.meta.guestPbl,
        guestLocalRecords: result.meta.guestLocalRecords,
      });
      setIsPublic(result.meta.isPublic);
    });
    return () => {
      cancelled = true;
    };
  }, [stageId, isOwner]);

  if (!isOwner || !stageId) return null;

  const patch = async (next: Partial<GuestPermissions>) => {
    setPermissions((current) => (current ? { ...current, ...next } : current));
    setBusy(true);
    try {
      const response = await fetch(`/api/stages/${encodeURIComponent(stageId)}/guest-permissions`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { permissions?: GuestPermissions };
      if (body.permissions) setPermissions(body.permissions);
    } catch {
      // Re-read the server's answer instead of keeping an optimistic lie.
      const result = await fetchStageMeta(stageId);
      if (result.outcome === 'found') {
        setPermissions({
          guestQuiz: result.meta.guestQuiz,
          guestTts: result.meta.guestTts,
          guestChat: result.meta.guestChat,
          guestPbl: result.meta.guestPbl,
          guestLocalRecords: result.meta.guestLocalRecords,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const setPublished = async (next: boolean) => {
    setIsPublic(next);
    setBusy(true);
    try {
      const response = await fetch(
        `/api/stages/${encodeURIComponent(stageId)}/${next ? 'publish' : 'unpublish'}`,
        { method: 'POST', credentials: 'include' },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { permissions?: GuestPermissions };
      if (body.permissions) setPermissions(body.permissions);
    } catch {
      setIsPublic(!next);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/classroom/${stageId}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        disabled={!canExport}
        title={canExport ? undefined : t('export.mediaPending')}
        className="cursor-pointer gap-2.5"
      >
        <ShieldCheck className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
        <div>
          <div>{t('guestAccess.menu')}</div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500">
            {t('guestAccess.menuDesc')}
          </div>
        </div>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[260px]" data-testid="guest-access-menu">
        <DropdownMenuCheckboxItem
          checked={isPublic}
          disabled={busy || permissions === null}
          onCheckedChange={(checked) => void setPublished(checked === true)}
        >
          {t('guestAccess.share')}
        </DropdownMenuCheckboxItem>
        <p className="mx-2 mb-1 max-w-[240px] text-[11px] leading-snug text-gray-400 dark:text-gray-500">
          {t('guestAccess.shareHint')}
        </p>
        {PERMISSION_ITEMS.map(([key, label]) => (
          <DropdownMenuCheckboxItem
            key={key}
            checked={permissions?.[key] ?? false}
            disabled={!isPublic || busy || permissions === null}
            onCheckedChange={(checked) =>
              void patch({ [key]: checked === true } as Partial<GuestPermissions>)
            }
          >
            {t(`guestAccess.${label}`)}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuItem onSelect={() => void copyLink()}>
          {copied ? (
            <Check className="w-4 h-4 text-green-500 shrink-0" aria-hidden="true" />
          ) : (
            <Copy className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
          )}
          <span>{copied ? t('guestAccess.copied') : t('guestAccess.copyLink')}</span>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
