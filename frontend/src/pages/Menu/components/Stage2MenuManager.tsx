import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/ipc';
import { formatPKR } from '../../../utils/money';
import { Button, Input, Select } from '../../../components/atoms';
import { Card } from '../../../components/atoms/card';
import { Category, MenuItemVariant, Modifier, ModifierGroup, Stage2Category, Stage2MenuItem } from '../../../types/models';

interface Props {
  menuId: number | null;
}

const emptyMessage = 'No records yet. Use the form above to add one.';

function resultError(result: { success: boolean; error?: string }): string {
  return result.success ? '' : (result.error ?? 'The operation could not be completed');
}

const Stage2MenuManager: React.FC<Props> = ({ menuId }) => {
  const [categories, setCategories] = useState<Stage2Category[]>([]);
  const [items, setItems] = useState<Stage2MenuItem[]>([]);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [variants, setVariants] = useState<MenuItemVariant[]>([]);
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [associatedGroupIds, setAssociatedGroupIds] = useState<number[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [notice, setNotice] = useState('');

  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [itemId, setItemId] = useState<number | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemDietaryLabel, setItemDietaryLabel] = useState('');
  const [variantId, setVariantId] = useState<number | null>(null);
  const [variantName, setVariantName] = useState('');
  const [variantPrice, setVariantPrice] = useState('');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupSelection, setGroupSelection] = useState<'single' | 'multiple'>('multiple');
  const [groupMin, setGroupMin] = useState('0');
  const [groupMax, setGroupMax] = useState('');
  const [modifierId, setModifierId] = useState<number | null>(null);
  const [modifierName, setModifierName] = useState('');
  const [modifierPrice, setModifierPrice] = useState('');

  const refreshCategories = useCallback(async () => {
    if (!menuId) {
      setCategories([]);
      setSelectedCategoryId(null);
      return;
    }
    const result = await api.stage2.categories.list({ menuId, includeInactive: true });
    if (result.success && result.data) {
      setCategories(result.data);
      setSelectedCategoryId(current => result.data?.some(category => category.id === current) ? current : (result.data?.[0]?.id ?? null));
    } else {
      setNotice(result.error ?? 'Unable to load categories');
    }
  }, [menuId]);

  const refreshGroups = useCallback(async () => {
    const result = await api.stage2.modifierGroups.list({ includeInactive: true });
    if (result.success && result.data) {
      setGroups(result.data);
      setSelectedGroupId(current => result.data?.some(group => group.id === current) ? current : (result.data?.[0]?.id ?? null));
    } else {
      setNotice(result.error ?? 'Unable to load modifier groups');
    }
  }, []);

  const refreshItems = useCallback(async () => {
    const result = await api.stage2.menuItems.list({ categoryId: selectedCategoryId ?? undefined, includeInactive: true });
    if (result.success && result.data) {
      setItems(result.data);
      setSelectedItemId(current => result.data?.some(item => item.id === current) ? current : (result.data?.[0]?.id ?? null));
    } else {
      setNotice(result.error ?? 'Unable to load menu items');
    }
  }, [selectedCategoryId]);

  const refreshItemDetails = useCallback(async () => {
    if (!selectedItemId) {
      setVariants([]);
      setAssociatedGroupIds([]);
      return;
    }
    const [variantResult, associationResult] = await Promise.all([
      api.stage2.variants.list({ menuItemId: selectedItemId, includeInactive: true }),
      api.stage2.menuItemModifierGroups.list(selectedItemId),
    ]);
    if (variantResult.success && variantResult.data) {
      setVariants(variantResult.data);
    }
    if (associationResult.success && associationResult.data) {
      setAssociatedGroupIds(associationResult.data.map(group => group.id));
    }
    if (!variantResult.success || !associationResult.success) {
      setNotice(variantResult.error ?? associationResult.error ?? 'Unable to load item details');
    }
  }, [selectedItemId]);

  const refreshModifiers = useCallback(async () => {
    if (!selectedGroupId) {
      setModifiers([]);
      return;
    }
    const result = await api.stage2.modifiers.list({ modifierGroupId: selectedGroupId, includeInactive: true });
    if (result.success && result.data) {
      setModifiers(result.data);
    } else {
      setNotice(result.error ?? 'Unable to load modifiers');
    }
  }, [selectedGroupId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshCategories(); }, [refreshCategories]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshGroups(); }, [refreshGroups]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshItems(); }, [refreshItems]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshItemDetails(); }, [refreshItemDetails]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshModifiers(); }, [refreshModifiers]);

  const selectedCategory = categories.find(category => category.id === selectedCategoryId);
  const selectedItem = items.find(item => item.id === selectedItemId);
  const visibleItems = useMemo(() => {
    const query = itemSearch.trim().toLowerCase();
    return query ? items.filter(item => item.name.toLowerCase().includes(query)) : items;
  }, [items, itemSearch]);

  const resetCategoryForm = () => {
    setCategoryId(null);
    setCategoryName('');
  };
  const resetItemForm = () => {
    setItemId(null);
    setItemName('');
    setItemPrice('');
    setItemDietaryLabel('');
  };
  const resetVariantForm = () => {
    setVariantId(null);
    setVariantName('');
    setVariantPrice('');
  };
  const resetGroupForm = () => {
    setGroupId(null);
    setGroupName('');
    setGroupSelection('multiple');
    setGroupMin('0');
    setGroupMax('');
  };
  const resetModifierForm = () => {
    setModifierId(null);
    setModifierName('');
    setModifierPrice('');
  };

  const saveCategoryForm = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!menuId) { return; }
    const result = await api.stage2.categories.save({ id: categoryId ?? undefined, menu_id: menuId, name: categoryName, is_active: 1 });
    const error = resultError(result);
    if (error) { setNotice(error); return; }
    setNotice('Category saved');
    resetCategoryForm();
    await refreshCategories();
  };

  const saveItemForm = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!selectedCategoryId) { setNotice('Select a category first'); return; }
    const existing = itemId ? items.find(item => item.id === itemId) : undefined;
    const result = await api.stage2.menuItems.save({
      id: itemId ?? undefined,
      category_id: selectedCategoryId,
      name: itemName,
      price: itemPrice,
      price_minor: undefined,
      is_veg: existing?.is_veg ?? 1,
      is_available: existing?.is_available ?? 1,
      is_active: 1,
      tax_name: existing?.tax_name ?? 'Sales Tax',
      tax_rate: existing?.tax_rate ?? 0,
      tax_mode: existing?.tax_mode ?? 'exclusive',
      dietary_label: itemDietaryLabel || null,
    });
    const error = resultError(result);
    if (error) { setNotice(error); return; }
    setNotice('Menu item saved');
    resetItemForm();
    await refreshItems();
  };

  const saveVariantForm = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!selectedItemId) { setNotice('Select a menu item first'); return; }
    const result = await api.stage2.variants.save({ id: variantId ?? undefined, menu_item_id: selectedItemId, name: variantName, price: variantPrice, is_active: 1 });
    const error = resultError(result);
    if (error) { setNotice(error); return; }
    setNotice('Variant saved');
    resetVariantForm();
    await refreshItemDetails();
  };

  const saveGroupForm = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    const result = await api.stage2.modifierGroups.save({
      id: groupId ?? undefined,
      name: groupName,
      selection_type: groupSelection,
      min_selections: Number(groupMin),
      max_selections: groupMax === '' ? null : Number(groupMax),
      is_active: 1,
    });
    const error = resultError(result);
    if (error) { setNotice(error); return; }
    setNotice('Modifier group saved');
    resetGroupForm();
    await refreshGroups();
  };

  const saveModifierForm = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!selectedGroupId) { setNotice('Select a modifier group first'); return; }
    const result = await api.stage2.modifiers.save({ id: modifierId ?? undefined, modifier_group_id: selectedGroupId, name: modifierName, price: modifierPrice, is_active: 1 });
    const error = resultError(result);
    if (error) { setNotice(error); return; }
    setNotice('Modifier saved');
    resetModifierForm();
    await refreshModifiers();
  };

  const editCategory = (category: Category) => {
    setCategoryId(category.id);
    setCategoryName(category.name);
  };
  const editItem = (item: Stage2MenuItem) => {
    setSelectedItemId(item.id);
    setItemId(item.id);
    setItemName(item.name);
    setItemPrice((item.price_minor / 100).toFixed(2));
    setItemDietaryLabel(item.dietary_label ?? '');
  };
  const editVariant = (variant: MenuItemVariant) => {
    setVariantId(variant.id);
    setVariantName(variant.name);
    setVariantPrice((variant.price_minor / 100).toFixed(2));
  };
  const editGroup = (group: ModifierGroup) => {
    setSelectedGroupId(group.id);
    setGroupId(group.id);
    setGroupName(group.name);
    setGroupSelection(group.selection_type);
    setGroupMin(String(group.min_selections));
    setGroupMax(group.max_selections === null ? '' : String(group.max_selections));
  };
  const editModifier = (modifier: Modifier) => {
    setModifierId(modifier.id);
    setModifierName(modifier.name);
    setModifierPrice((modifier.price_minor / 100).toFixed(2));
  };

  const toggleCategory = async (category: Stage2Category) => {
    const result = await api.stage2.categories.save({ id: category.id, menu_id: category.menu_id, name: category.name, sort_order: category.sort_order, is_active: category.is_active ? 0 : 1 });
    setNotice(resultError(result) || 'Category status updated');
    await refreshCategories();
  };
  const toggleItemActive = async (item: Stage2MenuItem) => {
    const result = item.is_active
      ? await api.stage2.menuItems.deactivate(item.id)
      : await api.stage2.menuItems.save({ id: item.id, category_id: item.category_id, name: item.name, price_minor: item.price_minor, is_active: 1, is_available: item.is_available, is_veg: item.is_veg });
    setNotice(resultError(result) || 'Menu item status updated');
    await refreshItems();
  };
  const toggleItemAvailability = async (item: Stage2MenuItem) => {
    const result = await api.stage2.menuItems.setAvailability({ id: item.id, isAvailable: item.is_available ? 0 : 1 });
    setNotice(resultError(result) || 'Availability updated');
    await refreshItems();
  };
  const toggleVariant = async (variant: MenuItemVariant) => {
    const result = variant.is_active
      ? await api.stage2.variants.deactivate(variant.id)
      : await api.stage2.variants.save({ id: variant.id, menu_item_id: variant.menu_item_id, name: variant.name, price_minor: variant.price_minor, is_active: 1 });
    setNotice(resultError(result) || 'Variant status updated');
    await refreshItemDetails();
  };
  const toggleGroup = async (group: ModifierGroup) => {
    const result = group.is_active
      ? await api.stage2.modifierGroups.deactivate(group.id)
      : await api.stage2.modifierGroups.save({ id: group.id, name: group.name, selection_type: group.selection_type, min_selections: group.min_selections, max_selections: group.max_selections, is_active: 1 });
    setNotice(resultError(result) || 'Modifier group status updated');
    await refreshGroups();
  };
  const toggleModifier = async (modifier: Modifier) => {
    const result = modifier.is_active
      ? await api.stage2.modifiers.deactivate(modifier.id)
      : await api.stage2.modifiers.save({ id: modifier.id, modifier_group_id: modifier.modifier_group_id, name: modifier.name, price_minor: modifier.price_minor, is_active: 1 });
    setNotice(resultError(result) || 'Modifier status updated');
    await refreshModifiers();
  };

  const saveAssociations = async () => {
    if (!selectedItemId) { return; }
    const result = await api.stage2.menuItemModifierGroups.set({ menuItemId: selectedItemId, modifierGroupIds: associatedGroupIds });
    setNotice(resultError(result) || 'Modifier groups associated');
    await refreshItemDetails();
  };

  return (
    <div className="space-y-5">
      {notice && <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800" role="status">{notice}</div>}
      {!menuId ? (
        <Card><p className="p-4 text-gray-500">Create or select a menu to manage its categories and items.</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-gray-900">Categories</h3><Button size="sm" variant="ghost" onClick={resetCategoryForm}>New</Button></div>
              <form onSubmit={(event) => { void saveCategoryForm(event); }} className="mb-4 space-y-2">
                <Input label={categoryId ? 'Edit category' : 'New category'} value={categoryName} onChange={event => { setCategoryName(event.target.value); }} placeholder="e.g. Breakfast" required />
                <div className="flex gap-2"><Button type="submit" size="sm">Save</Button>{categoryId && <Button type="button" size="sm" variant="ghost" onClick={resetCategoryForm}>Cancel</Button>}</div>
              </form>
              <div className="space-y-1">
                {categories.length === 0 ? <p className="text-sm text-gray-500">{emptyMessage}</p> : categories.map(category => (
                  <div key={category.id} className={`flex items-center gap-1 rounded-lg border p-2 ${selectedCategoryId === category.id ? 'border-blue-400 bg-blue-50' : 'border-gray-100'}`}>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setSelectedCategoryId(category.id); }}><span className="block truncate text-sm font-semibold">{category.name}</span><span className="text-xs text-gray-500">{category.is_active ? 'Active' : 'Inactive'}</span></button>
                    <button type="button" className="text-xs text-blue-600" onClick={() => { editCategory(category); }}>Edit</button>
                    <button type="button" className="text-xs text-gray-500" onClick={() => { void toggleCategory(category); }}>{category.is_active ? 'Off' : 'On'}</button>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-gray-900">Menu items</h3><p className="text-xs text-gray-500">{selectedCategory?.name ?? 'Select a category'} · prices stored in minor PKR units</p></div><Input fullWidth={false} aria-label="Search menu items" placeholder="Search items" value={itemSearch} onChange={event => { setItemSearch(event.target.value); }} /></div>
              <form onSubmit={(event) => { void saveItemForm(event); }} className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr_140px_150px_auto] md:items-end">
                <Input label={itemId ? 'Edit item' : 'New item'} value={itemName} onChange={event => { setItemName(event.target.value); }} placeholder="Dish name" required />
                <Input label="Price (PKR)" type="number" min="0" step="0.01" value={itemPrice} onChange={event => { setItemPrice(event.target.value); }} placeholder="0.00" required />
                <Input label="Dietary label" value={itemDietaryLabel} onChange={event => { setItemDietaryLabel(event.target.value); }} placeholder="Optional" />
                <div className="flex gap-2"><Button type="submit">Save</Button>{itemId && <Button type="button" variant="ghost" onClick={resetItemForm}>Cancel</Button>}</div>
              </form>
              <div className="grid gap-2 md:grid-cols-2">
                {visibleItems.length === 0 ? <p className="text-sm text-gray-500">{emptyMessage}</p> : visibleItems.map(item => (
                  <div key={item.id} className={`rounded-lg border p-3 ${selectedItemId === item.id ? 'border-blue-400 bg-blue-50' : 'border-gray-100'} ${!item.is_active ? 'opacity-60' : ''}`}>
                    <button type="button" className="w-full text-left" onClick={() => { setSelectedItemId(item.id); }}><div className="flex items-start justify-between gap-2"><span className="font-semibold text-gray-900">{item.name}</span><span className="font-semibold text-blue-700">{formatPKR(item.price_minor / 100)}</span></div><div className="mt-1 text-xs text-gray-500">{item.dietary_label ?? 'No dietary label'} · {item.is_active ? 'Active' : 'Inactive'} · {item.is_available ? 'Available' : 'Unavailable'}</div></button>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs"><button type="button" className="text-blue-600" onClick={() => { editItem(item); }}>Edit</button><button type="button" className="text-gray-600" onClick={() => { void toggleItemAvailability(item); }}>{item.is_available ? 'Mark unavailable' : 'Mark available'}</button><button type="button" className="text-gray-600" onClick={() => { void toggleItemActive(item); }}>{item.is_active ? 'Deactivate' : 'Activate'}</button></div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between"><div><h3 className="font-bold text-gray-900">Variants and sizes</h3><p className="text-xs text-gray-500">{selectedItem?.name ?? 'Select an item'} </p></div><Button size="sm" variant="ghost" onClick={resetVariantForm}>New</Button></div>
              <form onSubmit={(event) => { void saveVariantForm(event); }} className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr_130px_auto] md:items-end"><Input label="Variant name" value={variantName} onChange={event => { setVariantName(event.target.value); }} placeholder="Small, Large" required /><Input label="Price (PKR)" type="number" min="0" step="0.01" value={variantPrice} onChange={event => { setVariantPrice(event.target.value); }} required /><div className="flex gap-2"><Button type="submit">Save</Button>{variantId && <Button type="button" variant="ghost" onClick={resetVariantForm}>Cancel</Button>}</div></form>
              {variants.length === 0 ? <p className="text-sm text-gray-500">{emptyMessage}</p> : <div className="space-y-2">{variants.map(variant => <div key={variant.id} className="flex items-center justify-between rounded border border-gray-100 p-2 text-sm"><span className={!variant.is_active ? 'line-through opacity-60' : ''}>{variant.name} · <b>{formatPKR(variant.price_minor / 100)}</b></span><span className="flex gap-2 text-xs"><button type="button" className="text-blue-600" onClick={() => { editVariant(variant); }}>Edit</button><button type="button" className="text-gray-600" onClick={() => { void toggleVariant(variant); }}>{variant.is_active ? 'Off' : 'On'}</button></span></div>)}</div>}
            </Card>

            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between"><div><h3 className="font-bold text-gray-900">Modifier groups</h3><p className="text-xs text-gray-500">Create reusable add-on groups and options.</p></div><Button size="sm" variant="ghost" onClick={resetGroupForm}>New</Button></div>
              <form onSubmit={(event) => { void saveGroupForm(event); }} className="mb-4 space-y-2"><div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_130px]"><Input label="Group name" value={groupName} onChange={event => { setGroupName(event.target.value); }} placeholder="Extra toppings" required /><Select label="Selection" value={groupSelection} onChange={event => { setGroupSelection(event.target.value as 'single' | 'multiple'); }}><option value="multiple">Multiple</option><option value="single">Single</option></Select></div><div className="grid grid-cols-2 gap-2"><Input label="Minimum" type="number" min="0" value={groupMin} onChange={event => { setGroupMin(event.target.value); }} /><Input label="Maximum" type="number" min="0" value={groupMax} onChange={event => { setGroupMax(event.target.value); }} placeholder="None" /></div><div className="flex gap-2"><Button type="submit">Save group</Button>{groupId && <Button type="button" variant="ghost" onClick={resetGroupForm}>Cancel</Button>}</div></form>
              <div className="space-y-2">{groups.length === 0 ? <p className="text-sm text-gray-500">{emptyMessage}</p> : groups.map(group => <div key={group.id} className={`rounded border p-2 ${selectedGroupId === group.id ? 'border-indigo-400 bg-indigo-50' : 'border-gray-100'} ${!group.is_active ? 'opacity-60' : ''}`}><div className="flex items-center justify-between"><button type="button" className="text-left" onClick={() => { setSelectedGroupId(group.id); }}><b>{group.name}</b><span className="ml-2 text-xs text-gray-500">{group.selection_type}, {group.min_selections}-{group.max_selections ?? '∞'}</span></button><span className="flex gap-2 text-xs"><button type="button" className="text-blue-600" onClick={() => { editGroup(group); }}>Edit</button><button type="button" className="text-gray-600" onClick={() => { void toggleGroup(group); }}>{group.is_active ? 'Off' : 'On'}</button></span></div>{selectedGroupId === group.id && <div className="mt-2 border-t border-indigo-100 pt-2"><form onSubmit={(event) => { void saveModifierForm(event); }} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_110px_auto] md:items-end"><Input label={modifierId ? 'Edit add-on' : 'New add-on'} value={modifierName} onChange={event => { setModifierName(event.target.value); }} placeholder="Cheese" required /><Input label="Price (PKR)" type="number" min="0" step="0.01" value={modifierPrice} onChange={event => { setModifierPrice(event.target.value); }} placeholder="0" required /><div className="flex gap-2"><Button type="submit" size="sm">Save</Button>{modifierId && <Button type="button" size="sm" variant="ghost" onClick={resetModifierForm}>Cancel</Button>}</div></form><div className="mt-2 space-y-1">{modifiers.length === 0 ? <p className="text-xs text-gray-500">{emptyMessage}</p> : modifiers.map(modifier => <div key={modifier.id} className="flex justify-between text-sm"><span className={!modifier.is_active ? 'line-through opacity-60' : ''}>{modifier.name} · {formatPKR(modifier.price_minor / 100)}</span><span className="flex gap-2 text-xs"><button type="button" className="text-blue-600" onClick={() => { editModifier(modifier); }}>Edit</button><button type="button" className="text-gray-600" onClick={() => { void toggleModifier(modifier); }}>{modifier.is_active ? 'Off' : 'On'}</button></span></div>)}</div></div>}</div>)}</div>
            </Card>
          </div>

          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-gray-900">Item modifier associations</h3><p className="text-xs text-gray-500">{selectedItem?.name ?? 'Select a menu item'} · options appear in the order selected.</p></div><Button size="sm" onClick={() => { void saveAssociations(); }} disabled={!selectedItemId}>Save associations</Button></div>
            {selectedItemId ? <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">{groups.filter(group => group.is_active).map(group => <label key={group.id} className="flex cursor-pointer items-center gap-2 rounded border border-gray-100 p-3 text-sm"><input type="checkbox" checked={associatedGroupIds.includes(group.id)} onChange={event => { setAssociatedGroupIds(current => event.target.checked ? [...current, group.id] : current.filter(id => id !== group.id)); }} /> <span>{group.name}</span></label>)}</div> : <p className="text-sm text-gray-500">Select an item above to associate modifier groups.</p>}
          </Card>
        </>
      )}
    </div>
  );
};

export default Stage2MenuManager;
