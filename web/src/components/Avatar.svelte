<script lang="ts">
  import { textColorOn } from '../lib/color.ts';
  import type { Profile } from '../lib/profiles.ts';
  import Icon from './Icon.svelte';

  type Props = { profile: Profile; size?: number; dimmed?: boolean };
  let { profile, size = 72, dimmed = false }: Props = $props();
</script>

<span
  class="avatar"
  class:family={profile.isFamily}
  class:dimmed
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.45)}px"
  style:background={profile.isFamily ? undefined : profile.color}
  style:color={profile.isFamily ? undefined : textColorOn(profile.color)}
  aria-hidden="true"
>
  {#if profile.isFamily}
    <Icon name="family" size={Math.round(size * 0.5)} />
  {:else}
    {profile.name.charAt(0).toUpperCase()}
  {/if}
</span>

<style>
  .avatar {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-weight: 700;
    box-sizing: border-box;
  }

  .family {
    background: var(--surface-2);
    border: 2px dashed var(--border-strong);
    color: var(--fg);
  }

  .dimmed {
    opacity: 0.55;
  }
</style>
