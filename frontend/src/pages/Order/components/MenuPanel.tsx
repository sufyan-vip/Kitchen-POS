import { Button, Input } from '../../../components/atoms';
import React, { useState, useEffect } from 'react';
import { api } from '../../../lib/ipc';

import { CartItem, CartModifierSelection, MenuItem, MenuItemVariant, Modifier, ModifierGroup } from '../../../types/models';

interface Props {
  menuId: number | null;
  onAddItem: (item: CartItem) => void;
}

const MenuPanel: React.FC<Props> = ({ menuId, onAddItem }) => {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [variants, setVariants] = useState<MenuItemVariant[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [modifiersByGroup, setModifiersByGroup] = useState<Record<number, Modifier[]>>({});
  const [selectedVariant, setSelectedVariant] = useState<MenuItemVariant | null>(null);
  const [selectedModifierIds, setSelectedModifierIds] = useState<Record<number, number[]>>({});
  const [optionLoading, setOptionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMenu = async () => {
      if (!menuId) { return; }
      const res = await api.menu.getAll(menuId);
      if (res.success && res.data) {
        const allItems = res.data.flatMap((cat: { items?: MenuItem[] }) => cat.items ?? []);
        setItems(allItems);
      }
    };
    void fetchMenu();
  }, [menuId]);

  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  const openItemOptions = async (item: MenuItem) => {
    setSelectedItem(item);
    setSelectedVariant(null);
    setSelectedModifierIds({});
    setModifiersByGroup({});
    setSelectionError(null);
    setOptionLoading(true);
    try {
      const [variantRes, groupRes] = await Promise.all([
        api.stage2.variants.list({ menuItemId: item.id, includeInactive: false }),
        api.stage2.menuItemModifierGroups.list(item.id),
      ]);
      const variantList = variantRes.success ? variantRes.data ?? [] : [];
      const groupList = groupRes.success ? groupRes.data ?? [] : [];
      setVariants(variantList.filter(v => v.is_active !== 0));
      setModifierGroups(groupList.filter(g => g.is_active !== 0));
      const loaded: Record<number, Modifier[]> = {};
      await Promise.all(groupList.filter(g => g.is_active !== 0).map(async g => {
        const modRes = await api.stage2.modifiers.list({ modifierGroupId: g.id, includeInactive: false });
        if (modRes.success) { loaded[g.id] = (modRes.data ?? []).filter(m => m.is_active !== 0); }
      }));
      setModifiersByGroup(loaded);
    } catch {
      setVariants([]);
      setModifierGroups([]);
      setModifiersByGroup({});
    } finally {
      setOptionLoading(false);
    }
  };

  const toggleModifier = (group: ModifierGroup, modifier: Modifier) => {
    setSelectedModifierIds(prev => {
      const current = prev[group.id] ?? [];
      if (group.selection_type === 'single') {
        return { ...prev, [group.id]: [modifier.id] };
      }
      const next = current.includes(modifier.id) ? current.filter(id => id !== modifier.id) : [...current, modifier.id];
      return { ...prev, [group.id]: next };
    });
  };

  const selectedCountOk = (group: ModifierGroup): boolean => {
    const count = (selectedModifierIds[group.id] ?? []).length;
    if (count < group.min_selections) { return false; }
    if (group.max_selections !== null && count > group.max_selections) { return false; }
    return true;
  };

  const confirmSelection = () => {
    if (!selectedItem) { return; }
    for (const group of modifierGroups) {
      if (!selectedCountOk(group)) {
        setSelectionError(`Please select between ${group.min_selections}${group.max_selections === null ? '+' : ` and ${group.max_selections}`} option(s) from ${group.name}.`);
        return;
      }
    }
    setSelectionError(null);
    const selectedModifiers: CartModifierSelection[] = [];
    for (const group of modifierGroups) {
      for (const id of selectedModifierIds[group.id] ?? []) {
        const mod = (modifiersByGroup[group.id] ?? []).find(m => m.id === id);
        if (mod) { selectedModifiers.push({ id: mod.id, name: mod.name, price_minor: mod.price_minor, qty: 1 }); }
      }
    }
    const baseMinor = Math.round(selectedItem.price * 100);
    const variantMinor = selectedVariant ? selectedVariant.price_minor : baseMinor;
    const modifierMinor = selectedModifiers.reduce((s, m) => s + m.price_minor * m.qty, 0);
    const unitMinor = (selectedVariant ? variantMinor : baseMinor) + modifierMinor;
    onAddItem({
      id: selectedItem.id,
      name: selectedItem.name,
      price: unitMinor / 100,
      qty: 1,
      note: '',
      variant_id: selectedVariant?.id ?? null,
      variant_name: selectedVariant?.name ?? null,
      variant_price_minor: unitMinor,
      modifiers: selectedModifiers.length > 0 ? selectedModifiers : undefined,
    });
    setSelectedItem(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4">
        <Input
          type="text"
          placeholder="Search menu..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
        />
      </div>
      <div className="flex-1 overflow-auto grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-max pb-10">
        {filteredItems.map(item => (
          <div
            key={item.id}
            className="group hover-lift cursor-pointer flex flex-col justify-between overflow-hidden relative rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-blue-400/50"
            onClick={() => { void openItemOptions(item); }}
          >
            {item.image_url ? (
              <div className="w-full h-36 bg-gray-100 relative overflow-hidden">
                <img src={item.image_url.replace('file://', 'local://')} alt={item.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <span className={`absolute top-2 right-2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-md z-10 ${item.is_veg ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
              </div>
            ) : (
              <div className="pt-5 px-5 flex justify-between items-start mb-2 relative">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-blue-50 to-transparent rounded-bl-full opacity-50 z-0" />
                <span className={`w-3.5 h-3.5 rounded-full mt-1 flex-shrink-0 border-2 border-white shadow-sm z-10 relative ${item.is_veg ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                <h3 className="font-extrabold flex-1 ml-2 text-sm md:text-base leading-tight text-right text-gray-800 z-10 relative line-clamp-2">{item.name}</h3>
              </div>
            )}

            <div className={`p-5 flex flex-col z-10 bg-white ${item.image_url ? 'pt-3' : 'pt-0'}`}>
              {item.image_url && <h3 className="font-bold text-sm md:text-base leading-tight mb-1 text-gray-800 line-clamp-2">{item.name}</h3>}
              <div className="flex justify-between items-end mt-auto">
                <p className="text-blue-600 font-black text-lg tracking-tight">Rs {item.price.toFixed(2)}</p>

                {/* Plus Icon indicating add action */}
                <div className="bg-gray-50 text-gray-400 rounded-full p-1.5 opacity-0 group-hover:opacity-100 group-hover:bg-blue-50 group-hover:text-blue-600 transition-all transform translate-x-2 group-hover:translate-x-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-gray-800">{selectedItem.name}</h3>
                <p className="text-sm text-gray-500">Base: Rs {selectedItem.price.toFixed(2)}</p>
              </div>
              <button className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-2" onClick={() => { setSelectedItem(null); }}>×</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5 space-y-4">
              {selectionError && <p className="text-sm text-red-600">{selectionError}</p>}
              {optionLoading && <p className="text-sm text-gray-500">Loading options…</p>}
              {variants.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-gray-700 mb-2">Variants</h4>
                  <div className="flex flex-wrap gap-2">
                    {variants.map(v => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => { setSelectedVariant(v); }}
                        className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${selectedVariant?.id === v.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'}`}
                      >
                        {v.name} — Rs {(v.price_minor / 100).toFixed(2)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {modifierGroups.map(group => (
                <div key={group.id}>
                  <h4 className="text-sm font-bold text-gray-700 mb-1">{group.name}</h4>
                  <p className="text-xs text-gray-500 mb-2">
                    {group.selection_type === 'single' ? 'Select one' : 'Select multiple'}; min {group.min_selections}{group.max_selections === null ? '' : `, max ${group.max_selections}`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(modifiersByGroup[group.id] ?? []).map(mod => (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={() => { toggleModifier(group, mod); }}
                        className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${(selectedModifierIds[group.id] ?? []).includes(mod.id) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 border-gray-200 hover:border-emerald-300'}`}
                      >
                        {mod.name}{mod.price_minor > 0 ? ` +Rs ${(mod.price_minor / 100).toFixed(2)}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!optionLoading && variants.length === 0 && modifierGroups.length === 0 && (
                <p className="text-sm text-gray-500">No variants or options — this item will be added as-is.</p>
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setSelectedItem(null); }}>Cancel</Button>
              <Button variant="primary" onClick={confirmSelection} disabled={optionLoading}>Add to Order</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuPanel;
