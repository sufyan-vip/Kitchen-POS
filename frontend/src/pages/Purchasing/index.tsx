import { Button, Input, Select, Textarea } from '../../components/atoms';
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/ipc';
import { Supplier, Purchase, PurchaseItem, InventoryItem } from '../../types/models';
import { Card } from '../../components/atoms/card';
import { useModal } from '../../hooks/useModal';
import { useToast } from '../../hooks/useToast';

interface SupplierForm {
  id?: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

interface PurchaseLine {
  inventory_item_id: number;
  qty: string;
  unit_cost: string;
}

const emptySupplierForm: SupplierForm = { name: '', phone: '', email: '', address: '', notes: '' };

const PurchasingPage: React.FC = () => {
  const [tab, setTab] = useState<'suppliers' | 'purchases'>('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [purchaseItems, setPurchaseItems] = useState<Record<number, PurchaseItem[]>>({});
  const [expandedPurchase, setExpandedPurchase] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const { showModal, hideModal } = useModal();
  const { showToast } = useToast();

  const fetchSuppliers = useCallback(() => {
    void api.suppliers.list({ includeInactive: true }).then(res => {
      if (res.success && res.data) { setSuppliers(res.data); }
    });
  }, []);

  const fetchPurchases = useCallback(() => {
    void api.purchases.list().then(res => {
      if (res.success && res.data) { setPurchases(res.data); }
    });
  }, []);

  const fetchAll = useCallback(() => {
    setLoading(true);
    fetchSuppliers();
    fetchPurchases();
    void api.inventory.getAll().then(res => {
      if (res.success && res.data) { setInventoryItems(res.data); }
    }).finally(() => { setLoading(false); });
  }, [fetchSuppliers, fetchPurchases]);

  useEffect(() => {
    const timer = setTimeout(() => { fetchAll(); }, 0);
    return () => { clearTimeout(timer); };
  }, [fetchAll]);

  const openSupplierForm = (supplier?: Supplier) => {
    const form: SupplierForm = supplier
      ? { id: supplier.id, name: supplier.name, phone: supplier.phone ?? '', email: supplier.email ?? '', address: supplier.address ?? '', notes: supplier.notes ?? '' }
      : { ...emptySupplierForm };
    showModal({
      title: supplier ? 'Edit Supplier' : 'Add Supplier',
      content: (
        <SupplierFormFields
          initial={form}
          onSubmit={async (data) => {
            const res = await api.suppliers.save(data);
            if (res.success) {
              showToast({ message: supplier ? 'Supplier updated' : 'Supplier added', variant: 'success' });
              hideModal();
              fetchSuppliers();
            } else {
              showToast({ message: res.error ?? 'Failed to save supplier', variant: 'error' });
            }
          }}
        />
      ),
      actions: <></>,
    });
  };

  const toggleSupplierActive = async (supplier: Supplier) => {
    const res = await api.suppliers.save({ ...supplier, is_active: supplier.is_active === 1 ? 0 : 1 });
    if (res.success) {
      showToast({ message: supplier.is_active === 1 ? 'Supplier deactivated' : 'Supplier activated', variant: 'success' });
      fetchSuppliers();
    } else {
      showToast({ message: res.error ?? 'Failed to update supplier', variant: 'error' });
    }
  };

  const openCreatePurchase = () => {
    showModal({
      title: 'New Purchase Order',
      size: 'xl',
      content: (
        <PurchaseForm
          suppliers={suppliers.filter(s => s.is_active === 1)}
          inventoryItems={inventoryItems}
          onSubmit={async (payload) => {
            const res = await api.purchases.create(payload);
            if (res.success) {
              showToast({ message: `Purchase ${res.data?.purchase_number ?? ''} created`, variant: 'success' });
              hideModal();
              fetchPurchases();
            } else {
              showToast({ message: res.error ?? 'Failed to create purchase', variant: 'error' });
            }
          }}
        />
      ),
      actions: <></>,
    });
  };

  const togglePurchaseItems = async (purchaseId: number) => {
    if (expandedPurchase === purchaseId) {
      setExpandedPurchase(null);
      return;
    }
    if (!(purchaseId in purchaseItems)) {
      const res = await api.purchases.items({ purchaseId });
      if (res.success && res.data) {
        setPurchaseItems(prev => ({ ...prev, [purchaseId]: res.data }));
      }
    }
    setExpandedPurchase(purchaseId);
  };

  const receivePurchase = async (purchase: Purchase) => {
    const res = await api.purchases.receive({ purchaseId: purchase.id });
    if (res.success) {
      showToast({ message: `Purchase ${purchase.purchase_number} received — stock updated`, variant: 'success' });
      fetchPurchases();
    } else {
      showToast({ message: res.error ?? 'Failed to receive purchase', variant: 'error' });
    }
  };

  const cancelPurchase = async (purchase: Purchase) => {
    const res = await api.purchases.cancel({ purchaseId: purchase.id });
    if (res.success) {
      showToast({ message: `Purchase ${purchase.purchase_number} cancelled`, variant: 'success' });
      fetchPurchases();
    } else {
      showToast({ message: res.error ?? 'Failed to cancel purchase', variant: 'error' });
    }
  };

  const statusBadge = (status: Purchase['status']) => {
    const styles: Record<Purchase['status'], string> = {
      ORDERED: 'bg-amber-950 text-amber-400 border border-amber-900',
      RECEIVED: 'bg-emerald-950 text-emerald-400 border border-emerald-900',
      CANCELLED: 'bg-gray-800 text-gray-500 border border-gray-700',
    };
    return <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${styles[status]}`}>{status}</span>;
  };

  return (
    <div className="p-6 bg-gray-50 h-full overflow-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Suppliers &amp; Purchasing</h1>
        <div className="flex gap-2">
          <Button variant={tab === 'suppliers' ? 'primary' : 'outline'} size="sm" onClick={() => { setTab('suppliers'); }}>Suppliers</Button>
          <Button variant={tab === 'purchases' ? 'primary' : 'outline'} size="sm" onClick={() => { setTab('purchases'); }}>Purchase Orders</Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-16">Loading…</div>
      ) : null}
      {!loading && tab === 'suppliers' ? (
        <Card>
          <div className="flex justify-between items-center p-4 border-b">
            <h2 className="font-bold text-gray-700">Suppliers</h2>
            <Button variant="primary" size="sm" onClick={() => { openSupplierForm(); }}>+ Add Supplier</Button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500 border-b">
                <th className="p-3">Name</th>
                <th className="p-3">Phone</th>
                <th className="p-3">Email</th>
                <th className="p-3">Address</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-gray-400">No suppliers yet — add your first supplier.</td></tr>
              )}
              {suppliers.map(s => (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3 text-gray-600">{s.phone ?? '—'}</td>
                  <td className="p-3 text-gray-600">{s.email ?? '—'}</td>
                  <td className="p-3 text-gray-600">{s.address ?? '—'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${s.is_active === 1 ? 'bg-emerald-950 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}>
                      {s.is_active === 1 ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-2">
                    <Button variant="outline" size="sm" onClick={() => { openSupplierForm(s); }}>Edit</Button>
                    <Button variant="outline" size="sm" className="text-red-600 border-red-600" onClick={() => { void toggleSupplierActive(s); }}>
                      {s.is_active === 1 ? 'Deactivate' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      {!loading && tab !== 'suppliers' ? (
        <Card>
          <div className="flex justify-between items-center p-4 border-b">
            <h2 className="font-bold text-gray-700">Purchase Orders</h2>
            <Button variant="primary" size="sm" onClick={openCreatePurchase}>+ New Purchase Order</Button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500 border-b">
                <th className="p-3">PO #</th>
                <th className="p-3">Supplier</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3">Created</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {purchases.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-gray-400">No purchase orders yet.</td></tr>
              )}
              {purchases.map(p => (
                <React.Fragment key={p.id}>
                  <tr className="border-b hover:bg-gray-50">
                    <td className="p-3 font-medium">{p.purchase_number}</td>
                    <td className="p-3 text-gray-600">{p.supplier_name ?? `Supplier #${p.supplier_id}`}</td>
                    <td className="p-3">{statusBadge(p.status)}</td>
                    <td className="p-3 text-right font-semibold">Rs {(p.total_minor / 100).toFixed(2)}</td>
                    <td className="p-3 text-gray-600">{new Date(`${p.created_at}Z`).toLocaleString()}</td>
                    <td className="p-3 text-right space-x-2 whitespace-nowrap">
                      <Button variant="outline" size="sm" onClick={() => { void togglePurchaseItems(p.id); }}>
                        {expandedPurchase === p.id ? 'Hide Items' : 'Items'}
                      </Button>
                      {p.status === 'ORDERED' && (
                        <>
                          <Button variant="secondary" size="sm" onClick={() => { void receivePurchase(p); }}>Receive</Button>
                          <Button variant="outline" size="sm" className="text-red-600 border-red-600" onClick={() => { void cancelPurchase(p); }}>Cancel</Button>
                        </>
                      )}
                    </td>
                  </tr>
                  {expandedPurchase === p.id && (
                    <tr className="bg-gray-50">
                      <td colSpan={6} className="p-4">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs uppercase text-gray-500 border-b">
                              <th className="p-2">Item</th>
                              <th className="p-2 text-right">Qty</th>
                              <th className="p-2 text-right">Unit Cost</th>
                              <th className="p-2 text-right">Line Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(purchaseItems[p.id] ?? []).map(pi => (
                              <tr key={pi.id} className="border-b">
                                <td className="p-2">{pi.item_name ?? `Item #${pi.inventory_item_id}`} <span className="text-gray-400 text-xs">({pi.unit})</span></td>
                                <td className="p-2 text-right">{pi.qty}</td>
                                <td className="p-2 text-right">Rs {(pi.unit_cost_minor / 100).toFixed(2)}</td>
                                <td className="p-2 text-right font-medium">Rs {(pi.line_total_minor / 100).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
};

function SupplierFormFields({ initial, onSubmit }: { initial: SupplierForm; onSubmit: (data: SupplierForm) => Promise<void> }) {
  const [form, setForm] = useState<SupplierForm>(initial);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof SupplierForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [key]: e.target.value }));
  };
  const submit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { return; }
    setSaving(true);
    try {
      await onSubmit({ ...form, name: form.name.trim() });
    } finally {
      setSaving(false);
    }
  };
  return (
    <form id="supplier-form" onSubmit={(e) => { void submit(e); }} className="space-y-4 p-2">
      <Input label="Name *" value={form.name} onChange={set('name')} required />
      <Input label="Phone" value={form.phone} onChange={set('phone')} />
      <Input label="Email" type="email" value={form.email} onChange={set('email')} />
      <Input label="Address" value={form.address} onChange={set('address')} />
      <Textarea label="Notes" value={form.notes} onChange={set('notes')} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" form="supplier-form" variant="primary" disabled={saving}>Save Supplier</Button>
      </div>
    </form>
  );
}

function PurchaseForm({ suppliers, inventoryItems, onSubmit }: {
  suppliers: Supplier[];
  inventoryItems: InventoryItem[];
  onSubmit: (payload: { supplier_id: number; items: { inventory_item_id: number; qty: number; unit_cost: number | string }[]; note?: string | null }) => Promise<void>;
}) {
  const [supplierId, setSupplierId] = useState<number>(suppliers[0]?.id ?? 0);
  const [lines, setLines] = useState<PurchaseLine[]>([{ inventory_item_id: 0, qty: '1', unit_cost: '' }]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const updateLine = (idx: number, field: keyof PurchaseLine, value: string) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: field === 'inventory_item_id' ? Number(value) : value } : l));
  };

  const submit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!supplierId) {
      return;
    }
    const items = lines
      .filter(l => l.inventory_item_id > 0 && Number(l.qty) > 0)
      .map(l => ({ inventory_item_id: l.inventory_item_id, qty: Number(l.qty), unit_cost: l.unit_cost }));
    if (items.length === 0) { return; }
    setSaving(true);
    try {
      await onSubmit({ supplier_id: supplierId, items, note: note.trim() || null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form id="purchase-form" onSubmit={(e) => { void submit(e); }} className="space-y-4 p-2">
      <Select label="Supplier *" value={String(supplierId)} onChange={(e) => { setSupplierId(Number(e.target.value)); }}>
        {suppliers.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
      </Select>
      <div className="space-y-2">
        <div className="text-xs font-bold uppercase text-gray-500">Items</div>
        {lines.map((line, idx) => (
          <div key={idx} className="flex gap-2 items-end">
            <div className="flex-1">
              <Select label={idx === 0 ? 'Inventory item *' : undefined} value={String(line.inventory_item_id)} onChange={(e) => { updateLine(idx, 'inventory_item_id', e.target.value); }}>
                <option value="0">Select item…</option>
                {inventoryItems.map(ii => <option key={ii.id} value={String(ii.id)}>{ii.name} ({ii.unit})</option>)}
              </Select>
            </div>
            <div className="w-24">
              <Input label={idx === 0 ? 'Qty *' : undefined} type="number" min="1" step="any" value={line.qty} onChange={(e) => { updateLine(idx, 'qty', e.target.value); }} />
            </div>
            <div className="w-32">
              <Input label={idx === 0 ? 'Unit cost (PKR) *' : undefined} type="number" min="0" step="0.01" value={line.unit_cost} onChange={(e) => { updateLine(idx, 'unit_cost', e.target.value); }} />
            </div>
            <Button type="button" variant="ghost" size="icon" className="text-red-500" onClick={() => { setLines(prev => prev.filter((_, i) => i !== idx)); }}>✕</Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => { setLines(prev => [...prev, { inventory_item_id: 0, qty: '1', unit_cost: '' }]); }}>
          + Add Line
        </Button>
      </div>
      <Textarea label="Note" value={note} onChange={(e) => { setNote(e.target.value); }} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" form="purchase-form" variant="primary" disabled={saving || !supplierId}>Create Purchase Order</Button>
      </div>
    </form>
  );
}

export default PurchasingPage;
