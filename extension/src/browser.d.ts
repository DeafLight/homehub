// Extension « Remplir le panier » : le peu de l'API des extensions qu'on utilise (Chrome, Edge et Firefox exposent
// `chrome.*` en Manifest V3), déclaré à la main pour ne pas ajouter de dépendance.
declare namespace chrome {
  namespace storage {
    type Change = { oldValue?: unknown; newValue?: unknown };
    const local: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    const onChanged: { addListener(listener: (changes: Record<string, Change>, area: string) => void): void };
  }
  namespace tabs {
    type Tab = { id?: number; url?: string };
    function query(query: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
    function update(tabId: number, props: { url: string }): Promise<Tab>;
  }
  namespace permissions {
    function contains(p: { origins: string[] }): Promise<boolean>;
    function request(p: { origins: string[] }): Promise<boolean>;
  }
}
