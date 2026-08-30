import { Button, Select, BackButton } from '../../components/atoms';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MenuPanel from './components/MenuPanel';
import CartPanel from './components/CartPanel';
import { CartItem, CartModifierSelection, Customer, Menu, Order, OrderItem, Table } from '../../types/models';
import BillModal, { BillModalHandle } from './components/BillModal';
import CancelOrderModal from './components/CancelOrderModal';
import { api } from '../../lib/ipc';
import { useModal } from '../../hooks/useModal';
import { useToast } from '../../hooks/useToast';
import { CustomerSelect } from '../../components/organisms/CustomerSelect';
import { useAuthStore } from '../../store/auth';
import { useBusinessSession } from '../../contexts/BusinessSessionContext';
import { SvgIcon } from '../../components/atoms/svg-sprite-loader';

const OrderPage: React.FC = () => {
  const { tableId } = useParams();
  const navigate = useNavigate();
  const staff = useAuthStore(s => s.staff);
  const [unsentItems, setUnsentItems] = useState<CartItem[]>([]);
  const [sentKOTs, setSentKOTs] = useState<{ kotNumber: number; items: CartItem[] }[]>([]);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [tableInfo, setTableInfo] = useState<Table | null>(null);
  const [allTables, setAllTables] = useState<Table[]>([]);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [orderType, setOrderType] = useState<'dine-in' | 'takeaway' | 'delivery'>(Number(tableId) === 0 ? 'takeaway' : 'dine-in');
  const [occupiedTime, setOccupiedTime] = useState<string>('');
  const [sending, setSending] = useState(false);
  const { activeSession } = useBusinessSession();
  const { showModal, hideModal } = useModal();
  const { showToast } = useToast();
  const billModalRef = useRef<BillModalHandle>(null);

  const [menus, setMenus] = useState<Menu[]>([]);
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);

  const buildCartFromOrderItem = useCallback((i: OrderItem): CartItem => {
    let modifiers: CartModifierSelection[] = [];
    if (i.modifier_snapshot) {
      try {
        const parsed = JSON.parse(i.modifier_snapshot) as Array<{ id: number; name: string; price_minor: number; qty: number }>;
        modifiers = parsed.map(p => ({ id: p.id, name: p.name, price_minor: p.price_minor, qty: p.qty }));
      } catch {
        modifiers = [];
      }
    }
    return {
      id: i.menu_item_id,
      orderItemId: i.id,
      name: i.name,
      price: i.unit_price,
      qty: i.qty,
      note: i.note ?? '',
      status: i.preparation_status,
      originalQty: i.qty,
      kot_number: i.kot_number,
      variant_id: i.variant_id,
      variant_name: i.variant_name,
      variant_price_minor: i.unit_price_minor,
      modifiers: modifiers.length > 0 ? modifiers : undefined,
      modifier_snapshot: i.modifier_snapshot ?? null,
    };
  }, []);

  const loadOrderData = useCallback((orderData: (Order & { items: OrderItem[] })) => {
    const items = orderData.items.map(buildCartFromOrderItem);
    const unsent = items.filter(i => !i.kot_number);
    const sent = items.filter(i => i.kot_number !== undefined);
    const byKot = new Map<number, CartItem[]>();
    for (const item of sent) {
      const kotNum = typeof item.kot_number === 'number' ? item.kot_number : 0;
      byKot.set(kotNum, [...(byKot.get(kotNum) ?? []), item]);
    }
    setUnsentItems(unsent);
    setSentKOTs([...byKot.entries()].map(([kotNumber, kotItems]) => ({ kotNumber, items: kotItems })).sort((a, b) => b.kotNumber - a.kotNumber));
  }, [buildCartFromOrderItem]);

  const refreshOrderItems = useCallback(async (id: number) => {
    const res = await api.orders.getById({ orderId: id });
    if (res.success && res.data) {
      loadOrderData(res.data);
    }
    return res;
  }, [loadOrderData]);

  useEffect(() => {
    let active = true;
    api.menu.getMenus().then(res => {
      if (active && res.success && res.data) {
        const activeMenus = res.data.filter(m => m.is_active === 1);
        setMenus(activeMenus);
        if (activeMenus.length > 0) {
          const defaultMenu = activeMenus.find(m => m.is_default);
          setActiveMenuId(defaultMenu?.id ?? activeMenus[0].id);
        }
      }
    }).catch(console.error);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const applyOrder = (orderData: (Order & { items: OrderItem[] })) => {
      setOrderId(orderData.id);
      setCreatedAt(orderData.created_at);
      setOrderType(orderData.type);
      loadOrderData(orderData);
      if (orderData.customer_id) {
        api.customers.getById(orderData.customer_id).then(custRes => {
          if (active && custRes.success && custRes.data) {
            setCustomer(custRes.data);
          } else if (active) {
            setCustomer({
              id: orderData.customer_id as number,
              name: orderData.customer_name ?? 'Unknown',
              phone: null, email: null, loyalty_points: 0, total_visits: 0,
              credit_limit: 0, outstanding_balance: 0, created_at: '',
            });
          }
        }).catch(console.error);
      }
    };

    if (tableId && Number(tableId) !== 0) {
      api.orders.getByTable({ tableId: Number(tableId) })
        .then(res => {
          if (active && res.success && res.data) { applyOrder(res.data); }
        })
        .catch((err: unknown) => { console.error(err); });

      api.tables.getAll().then(res => {
        if (active && res.success && res.data) {
          setAllTables(res.data);
          const t = res.data.find(x => x.id === Number(tableId));
          if (t) { setTableInfo(t); }
        }
      }).catch((err: unknown) => { console.error(err); });
    } else {
      // Takeaway/delivery use the latest server-side draft as the persistent cart.
      api.orders.getDraft().then(res => {
        if (active && res.success && res.data) { applyOrder(res.data); }
      }).catch((err: unknown) => { console.error(err); });
    }
    return () => { active = false; };
  }, [tableId, loadOrderData]);

  useEffect(() => {
    if (!createdAt) {
      const timer = setTimeout(() => { setOccupiedTime(''); }, 0);
      return () => { clearTimeout(timer); };
    }
    const updateTime = () => {
      const dateStr = createdAt.endsWith('Z') ? createdAt : `${createdAt.replace(' ', 'T')  }Z`;
      const ms = Math.max(0, Date.now() - new Date(dateStr).getTime());
      const mins = Math.floor(ms / 60000);
      const hrs = Math.floor(mins / 60);
      const remainingMins = mins % 60;
      let timeStr = '';
      if (hrs > 0) {
        timeStr += `${hrs}h `;
      }
      timeStr += `${remainingMins}m`;
      setOccupiedTime(timeStr);
    };
    updateTime();
    const timer = setInterval(updateTime, 60000);
    return () => { clearInterval(timer); };
  }, [createdAt]);

  const handleRenameTable = () => {
    if (!tableInfo) { return; }
    let newName = tableInfo.custom_name ?? '';
    showModal({
      title: 'Rename Table (Temporary)',
      content: (
        <div className="p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Temporary Party/Customer Name</label>
          <input
            type="text"
            className="w-full border rounded p-2"
            defaultValue={newName}
            onChange={(e) => { newName = e.target.value; }}
            autoFocus
          />
        </div>
      ),
      actions: (
        <>
          <Button variant="outline" onClick={hideModal}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              hideModal();
              const nameToSet = newName.trim() === '' ? null : newName.trim();
              api.tables.updateCustomName({ id: tableInfo.id, customName: nameToSet }).then(res => {
                if (res.success) {
                  setTableInfo({ ...tableInfo, custom_name: nameToSet });
                  showToast({ message: 'Table name updated temporarily', variant: 'success' });
                } else {
                  showToast({ message: `Failed to rename table: ${res.error ?? 'Unknown error'}`, variant: 'error' });
                }
              }).catch((err: unknown) => {
                showToast({ message: `Error: ${err instanceof Error ? err.message : String(err)}`, variant: 'error' });
              });
            }}
          >
            Save
          </Button>
        </>
      )
    });
  };

  const handleChangeTable = () => {
    if (!orderId) {
      showToast({ message: 'Create the order before changing its table', variant: 'warning' });
      return;
    }
    let targetTableId = Number(tableId);
    showModal({
      title: 'Change Table',
      content: (
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-600">Move this dine-in order to another available table.</p>
          <Select value={String(targetTableId)} onChange={(e) => { targetTableId = Number(e.target.value); }}>
            {allTables.map(t => (
              <option key={t.id} value={String(t.id)}>{t.name} — {t.custom_name ? `${t.custom_name} · ` : ''}{t.status === 'occupied' ? 'Occupied' : 'Available'}</option>
            ))}
          </Select>
        </div>
      ),
      actions: (
        <>
          <Button variant="outline" onClick={hideModal}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!targetTableId || targetTableId === Number(tableId)}
            onClick={() => {
              hideModal();
              void api.orders.changeTable({ orderId, tableId: targetTableId }).then(res => {
                if (res.success) {
                  showToast({ message: 'Order moved to the selected table', variant: 'success' });
                  navigate(`/order/${targetTableId}`);
                } else {
                  showToast({ message: res.error ?? 'Failed to change table', variant: 'error' });
                }
              }).catch((err: unknown) => {
                showToast({ message: `Failed to change table: ${err instanceof Error ? err.message : String(err)}`, variant: 'error' });
              });
            }}
          >
            Move Order
          </Button>
        </>
      ),
    });
  };

  const handleCustomerSelect = async (selected: Customer | null) => {
    setCustomer(selected);
    if (!selected) {
      return;
    }

    if (!activeSession && !orderId) {
      showToast({ message: 'Please start a business day first to create a new order', variant: 'warning' });
      return;
    }

    if (orderId) {
      await api.orders.updateCustomer({ orderId, customerId: selected.id });
    } else if (tableId) {
      const res = await api.orders.create({
        tableId: Number(tableId) === 0 ? null : Number(tableId),
        staffId: staff?.id,
        customerId: selected.id,
        type: orderType,
      });
      if (res.success && res.data) {
        setOrderId(res.data.id);
        setCreatedAt(new Date().toISOString());
        showToast({ message: `Table reserved for ${selected.name}`, variant: 'success' });
      }
    }
  };

  const cartLineKey = (item: CartItem): string => {
    const mods = (item.modifiers ?? []).map(m => `${m.id}x${m.qty}`).sort().join(',');
    return `${item.id}:${item.variant_id ?? 'base'}:${mods}`;
  };

  const handleAddItem = async (menuItem: CartItem) => {
    try {
      const key = cartLineKey(menuItem);
      const existing = unsentItems.find(item => cartLineKey(item) === key);
      if (existing?.orderItemId) {
        const newQty = existing.qty + 1;
        setUnsentItems(prev => prev.map(item => item.orderItemId === existing.orderItemId ? { ...item, qty: newQty } : item));
        await api.orders.updateItemQty({ orderId: orderId as number, orderItemId: existing.orderItemId, qty: newQty });
        return;
      }

      let currentOrderId = orderId;
      if (!currentOrderId) {
        if (!activeSession) {
          showToast({ message: 'Please start a business day first to create a draft order', variant: 'warning' });
          return;
        }
        const createRes = await api.orders.create({
          tableId: Number(tableId) === 0 ? null : Number(tableId),
          staffId: staff?.id,
          customerId: customer?.id,
          type: orderType,
          status: 'DRAFT',
        });
        if (!createRes.success || !createRes.data) {
          showToast({ message: createRes.error ?? 'Failed to create draft order', variant: 'error' });
          return;
        }
        currentOrderId = createRes.data.id;
        setOrderId(currentOrderId);
        setCreatedAt(new Date().toISOString());
      }

      const addRes = await api.orders.addItems({
        orderId: currentOrderId,
        items: [{
          menu_item_id: menuItem.id,
          qty: menuItem.qty,
          note: menuItem.note.trim() || null,
          variant_id: menuItem.variant_id ?? null,
          modifiers: (menuItem.modifiers ?? []).map(m => ({ id: m.id, qty: m.qty })),
        }],
        staffId: staff?.id,
        keepDraft: true,
      });
      if (!addRes.success) {
        showToast({ message: addRes.error ?? 'Failed to save cart item', variant: 'error' });
        return;
      }
      await refreshOrderItems(currentOrderId);
    } catch (e: unknown) {
      showToast({ message: `Failed to save cart item: ${e instanceof Error ? e.message : String(e)}`, variant: 'error' });
    }
  };

  const handleUpdateQty = async (id: number, delta: number) => {
    const item = unsentItems.find(i => i.id === id);
    if (!item) { return; }
    const newQty = item.qty + delta;
    if (newQty <= 0) {
      if (item.orderItemId && orderId) {
        const res = await api.orders.voidItem({ orderId, orderItemId: item.orderItemId, reason: 'Removed from cart before KOT' });
        if (res.success) { await refreshOrderItems(orderId); }
      } else {
        setUnsentItems(prev => prev.filter(i => i.id !== id));
      }
      return;
    }
    setUnsentItems(prev => prev.map(i => i.id === id ? { ...i, qty: newQty } : i));
    if (item.orderItemId && orderId) {
      const res = await api.orders.updateItemQty({ orderId, orderItemId: item.orderItemId, qty: newQty });
      if (!res.success) { showToast({ message: res.error ?? 'Failed to update quantity', variant: 'error' }); }
    }
  };

  const handleUpdateNote = async (id: number, note: string) => {
    const item = unsentItems.find(i => i.id === id);
    if (!item) { return; }
    setUnsentItems(prev => prev.map(i => i.id === id ? { ...i, note } : i));
    if (item.orderItemId && orderId) {
      const res = await api.orders.updateItemNote({ orderId, orderItemId: item.orderItemId, note });
      if (!res.success) { showToast({ message: res.error ?? 'Failed to update note', variant: 'error' }); }
    }
  };

  const handleCancelItem = (orderItemId: number) => {
    if (!orderId) { return; }
    showModal({
      title: 'Void Item',
      content: <CancelOrderModal onConfirm={(note) => { 
        hideModal();
        api.orders.voidItem({ orderId, orderItemId, reason: note })
          .then(async res => {
            if (res.success) {
              showToast({ message: 'Item cancelled successfully', variant: 'success' });
              await refreshOrderItems(orderId);
            } else {
              showToast({ message: `Failed to cancel item: ${res.error ?? 'Unknown error'}`, variant: 'error' });
            }
          })
          .catch((err: unknown) => {
             showToast({ message: `Error: ${err instanceof Error ? err.message : String(err)}`, variant: 'error' });
          });
      }} />,
      actions: (
        <>
          <Button variant="outline" onClick={hideModal}>Go Back</Button>
          <Button type="submit" form="cancel-order-form" variant="danger">Confirm Void</Button>
        </>
      ),
    });
  };

  const handleSendKOT = async (shouldPrint: boolean) => {
    if (unsentItems.length === 0 || sending) {
      return;
    }

    if (!activeSession && !orderId) {
      showToast({ message: 'Please start a business day first to create a new order', variant: 'warning' });
      return;
    }

    setSending(true);
    try {
      // 1. Create the order on first submission (tableId 0 = takeaway/delivery).
      let currentOrderId = orderId;
      if (!currentOrderId) {
        const createRes = await api.orders.create({
          tableId: Number(tableId) === 0 ? null : Number(tableId),
          staffId: staff?.id,
          customerId: customer?.id,
          type: orderType,
        });
        if (!createRes.success || !createRes.data) {
          showToast({ message: createRes.error ?? 'Failed to create order', variant: 'error' });
          return;
        }
        currentOrderId = createRes.data.id;
        setOrderId(currentOrderId);
        setCreatedAt(new Date().toISOString());
      }

      // 2. Persist any cart lines that are not yet stored on the draft order.
      // Lines already stored server-side are not duplicated here.
      const itemsToPersist = unsentItems.filter(item => !item.orderItemId);
      if (itemsToPersist.length > 0) {
        const addRes = await api.orders.addItems({
          orderId: currentOrderId,
          items: itemsToPersist.map(item => ({
            menu_item_id: item.id,
            qty: item.qty,
            note: item.note.trim() || null,
            variant_id: item.variant_id ?? null,
            modifiers: (item.modifiers ?? []).map(m => ({ id: m.id, qty: m.qty })),
          })),
          staffId: staff?.id,
        });
        if (!addRes.success) {
          showToast({ message: addRes.error ?? 'Failed to save items', variant: 'error' });
          return;
        }
      }

      // 3. Send the new items to the kitchen (KOT).
      const kotRes = await api.orders.sendKOT({ orderId: currentOrderId, staffId: staff?.id });
      if (!kotRes.success || !kotRes.data) {
        showToast({ message: kotRes.error ?? 'Failed to send KOT', variant: 'error' });
        return;
      }

      if (shouldPrint && kotRes.data.items.length > 0) {
        let tableLabel = `Table ${tableId}`;
        if (Number(tableId) === 0) { tableLabel = orderType === 'delivery' ? 'Delivery' : 'Takeaway'; }
        api.print.kot({
          items: kotRes.data.items.map(i => ({ name: i.name, qty: i.qty })),
          tableName: tableLabel,
          orderNote: '',
        }).catch(console.error);
      } else {
        showToast({ message: 'Order saved successfully.', variant: 'success' });
      }
      setUnsentItems([]);
      navigate('/tables');
    } catch (e: unknown) {
      showToast({ message: `Error: ${e instanceof Error ? e.message : String(e)}`, variant: 'error' });
    } finally {
      setSending(false);
    }
  };

  const handleCancelOrder = async (note: string) => {
    if (!tableId) {
      return;
    }
    if (!orderId) {
      setUnsentItems([]);
      hideModal();
      navigate('/tables');
      return;
    }
    try {
      const res = await api.orders.cancelOrder({ orderId, note });
      if (res.success) {
        setUnsentItems([]);
        setSentKOTs([]);
        hideModal();
        navigate('/tables');
      } else {
        showToast({ message: `Failed to cancel order: ${res.error}`, variant: 'error' });
      }
    } catch (e: unknown) {
      showToast({ message: `An unexpected error occurred: ${e instanceof Error ? e.message : String(e)}`, variant: 'error' });
    }
  };

  return (
    <div className="flex h-full bg-white relative">
      <div className="absolute top-0 left-0 p-4 z-10">
        <BackButton to="/tables" label="Back to Tables" />
      </div>

      <div className="flex-1 p-6 pt-14 border-r bg-gray-50 flex flex-col overflow-hidden">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Menu</h1>
          {menus.length > 1 && (
            <div className="w-48">
              <Select
                value={String(activeMenuId ?? '')}
                onChange={(e) => { setActiveMenuId(Number(e.target.value)); }}
              >
                {menus.map(m => (
                  <option key={m.id} value={String(m.id)}>{m.name}</option>
                ))}
              </Select>
            </div>
          )}
        </div>
        <MenuPanel menuId={activeMenuId} onAddItem={(item) => { void handleAddItem(item); }} />
      </div>

      <div className="w-96 bg-white p-6 pt-6 flex flex-col shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)] z-0">
        <div className="flex justify-between items-center mb-4">
          <div className="flex flex-col">
            <h2 className="text-xl font-bold text-gray-800">Current Order</h2>
            {occupiedTime && (
              <div className="flex items-center gap-1 text-xs font-medium text-gray-500">
                <SvgIcon name="clock" className="h-3.5 w-3.5" aria-hidden={true} />
                <span>Occupied: {occupiedTime}</span>
              </div>
            )}
          </div>
          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-bold">
            {Number(tableId) === 0 ? (
              <select 
                value={orderType} 
                onChange={e => { setOrderType(e.target.value as 'dine-in' | 'takeaway' | 'delivery'); }}
                className="bg-transparent text-blue-800 font-bold focus:outline-none"
              >
                <option value="takeaway">Takeaway</option>
                <option value="delivery">Delivery</option>
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <span>
                  {(() => {
                    if (!tableInfo) { return `Table ${tableId}`; }
                    if (tableInfo.custom_name) { return `${tableInfo.name} (${tableInfo.custom_name})`; }
                    return tableInfo.name;
                  })()}
                </span>
                <button onClick={handleRenameTable} className="text-blue-500 hover:text-blue-700 focus:outline-none bg-blue-50 rounded-full p-1" title="Set temporary table name">
                  <SvgIcon name="pencil" className="h-3.5 w-3.5" />
                </button>
                <button onClick={handleChangeTable} className="text-blue-500 hover:text-blue-700 focus:outline-none bg-blue-50 rounded-full p-1" title="Move order to another table">
                  <SvgIcon name="arrow-right" className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </span>
        </div>

        <div className="mb-4">
          <CustomerSelect
            selectedCustomer={customer}
            onSelect={(c) => { void handleCustomerSelect(c); }}
            placeholder="Assign Customer (Optional)"
          />
        </div>

        <CartPanel
          unsentItems={unsentItems}
          sentKOTs={sentKOTs}
          onUpdateQty={(id, delta) => { void handleUpdateQty(id, delta); }}
          onUpdateNote={(id, note) => { void handleUpdateNote(id, note); }}
          onCancelItem={(orderItemId) => { handleCancelItem(orderItemId); }}
          onSendKOT={(print) => { void handleSendKOT(print); }}
          onGenerateBill={() => {
            if (!orderId) {
              showToast({ message: 'Order has not been sent to kitchen yet!', variant: 'warning' });
              return;
            }
            if (unsentItems.length > 0) {
              showToast({ message: 'Please save or send new items before generating bill.', variant: 'warning' });
              return;
            }
            const allItems = sentKOTs.flatMap(k => k.items);
            showModal({
              title: 'Generate Final Bill',
              content: <BillModal ref={billModalRef} orderId={orderId} cart={allItems} initialCustomer={customer} onClose={hideModal} />,
              size: 'xl',
              actions: (
                <>
                  <Button variant="outline" onClick={hideModal}>Cancel</Button>
                  <Button type="button" variant="secondary" onClick={() => { billModalRef.current?.save(); }}>Complete & Save</Button>
                  <Button type="button" variant="primary" onClick={() => { billModalRef.current?.print(); }}>Print Receipt</Button>
                </>
              ),
            });
          }}
          onVoidOrder={() => {
            showModal({
              title: 'Void Order',
              content: <CancelOrderModal onConfirm={(note) => { void handleCancelOrder(note); }} />,
              actions: (
                <>
                  <Button variant="outline" onClick={hideModal}>Go Back</Button>
                  <Button type="submit" form="cancel-order-form" variant="danger">Confirm Void Order</Button>
                </>
              ),
            });
          }}
        />
      </div>
    </div>
  );
};

export default OrderPage;
