import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Select } from '../../components/atoms';
import { Card } from '../../components/atoms/card';
import { api } from '../../lib/ipc';
import { DiningArea, Stage2Table, Stage2TableShape, Stage2TableStatus } from '../../types/models';

const statuses: Stage2TableStatus[] = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'DISABLED'];
const statusStyles: Record<Stage2TableStatus, string> = {
  AVAILABLE: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  OCCUPIED: 'border-amber-300 bg-amber-50 text-amber-800',
  RESERVED: 'border-violet-300 bg-violet-50 text-violet-800',
  CLEANING: 'border-sky-300 bg-sky-50 text-sky-800',
  DISABLED: 'border-gray-300 bg-gray-100 text-gray-600',
};

interface TableForm {
  id?: number;
  identifier: string;
  name: string;
  capacity: string;
  status: Stage2TableStatus;
  shape: Stage2TableShape;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  rotation: number;
  is_active: number;
}

const newTableForm = (areaId: number | null): TableForm => ({
  identifier: '', name: '', capacity: '4', status: 'AVAILABLE', shape: 'rectangle',
  position_x: 24, position_y: 24, width: 132, height: 88, rotation: 0, is_active: 1,
  ...(areaId ? { id: undefined } : {}),
});

function errorText(result: { success: boolean; error?: string }): string {
  return result.success ? '' : (result.error ?? 'The operation could not be completed');
}

const TablesPage: React.FC = () => {
  const navigate = useNavigate();
  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [tables, setTables] = useState<Stage2Table[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [areaId, setAreaId] = useState<number | null>(null);
  const [areaName, setAreaName] = useState('');
  const [areaSortOrder, setAreaSortOrder] = useState('0');
  const [tableForm, setTableForm] = useState<TableForm>(newTableForm(null));
  const [notice, setNotice] = useState('');

  const refreshAreas = useCallback(async () => {
    const result = await api.stage2.diningAreas.list({ includeInactive: true });
    if (result.success && result.data) {
      setAreas(result.data);
      setSelectedAreaId(current => result.data?.some(area => area.id === current) ? current : (result.data?.[0]?.id ?? null));
    } else {
      setNotice(result.error ?? 'Unable to load dining areas');
    }
  }, []);

  const refreshTables = useCallback(async () => {
    const result = await api.stage2.tables.list({ diningAreaId: selectedAreaId ?? undefined, includeInactive: true });
    if (result.success && result.data) {
      setTables(result.data);
      setSelectedTableId(current => result.data?.some(table => table.id === current) ? current : (result.data?.[0]?.id ?? null));
    } else {
      setNotice(result.error ?? 'Unable to load tables');
    }
  }, [selectedAreaId]);

  useEffect(() => {
    const timer = setTimeout(() => { void refreshAreas(); }, 0);
    return () => { clearTimeout(timer); };
  }, [refreshAreas]);
  useEffect(() => {
    const timer = setTimeout(() => { void refreshTables(); }, 0);
    return () => { clearTimeout(timer); };
  }, [refreshTables]);

  const selectedArea = areas.find(area => area.id === selectedAreaId);
  const visibleTables = useMemo(() => tables.filter(table => table.dining_area_id === selectedAreaId), [tables, selectedAreaId]);

  const resetAreaForm = () => {
    setAreaId(null);
    setAreaName('');
    setAreaSortOrder('0');
  };
  const resetTableForm = () => {
    setTableForm(newTableForm(selectedAreaId));
  };

  const saveArea = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    const result = await api.stage2.diningAreas.save({ id: areaId ?? undefined, name: areaName, sort_order: Number(areaSortOrder || 0), is_active: 1 });
    const error = errorText(result);
    if (error) { setNotice(error); return; }
    setNotice('Dining area saved');
    resetAreaForm();
    await refreshAreas();
  };

  const saveTable = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!selectedAreaId) { setNotice('Create or select a dining area first'); return; }
    const result = await api.stage2.tables.save({
      id: tableForm.id,
      dining_area_id: selectedAreaId,
      identifier: tableForm.identifier,
      name: tableForm.name || tableForm.identifier,
      capacity: Number(tableForm.capacity),
      status: tableForm.status,
      shape: tableForm.shape,
      is_active: 1,
      position_x: tableForm.position_x,
      position_y: tableForm.position_y,
      width: tableForm.width,
      height: tableForm.height,
      rotation: tableForm.rotation,
    });
    const error = errorText(result);
    if (error) { setNotice(error); return; }
    setNotice('Table saved');
    resetTableForm();
    await refreshTables();
  };

  const editArea = (area: DiningArea) => {
    setAreaId(area.id);
    setAreaName(area.name);
    setAreaSortOrder(String(area.sort_order));
  };
  const editTable = (table: Stage2Table) => {
    setSelectedTableId(table.id);
    setTableForm({
      id: table.id, identifier: table.identifier, name: table.name, capacity: String(table.capacity), status: table.status,
      shape: table.shape, position_x: table.position_x, position_y: table.position_y, width: table.width, height: table.height,
      rotation: table.rotation, is_active: table.is_active,
    });
  };

  const toggleArea = async (area: DiningArea) => {
    const result = area.is_active
      ? await api.stage2.diningAreas.deactivate(area.id)
      : await api.stage2.diningAreas.save({ id: area.id, name: area.name, sort_order: area.sort_order, is_active: 1 });
    setNotice(errorText(result) || 'Dining area status updated');
    await refreshAreas();
  };
  const toggleTable = async (table: Stage2Table) => {
    const result = table.is_active
      ? await api.stage2.tables.deactivate(table.id)
      : await api.stage2.tables.save({
        id: table.id, dining_area_id: table.dining_area_id, identifier: table.identifier, name: table.name, capacity: table.capacity,
        status: 'AVAILABLE', shape: table.shape, is_active: 1, position_x: table.position_x, position_y: table.position_y,
        width: table.width, height: table.height, rotation: table.rotation,
      });
    setNotice(errorText(result) || 'Table status updated');
    await refreshTables();
  };
  const updateStatus = async (table: Stage2Table, status: Stage2TableStatus) => {
    const result = await api.stage2.tables.updateStatus({ id: table.id, status });
    setNotice(errorText(result) || 'Table status updated');
    await refreshTables();
  };

  const moveTable = async (table: Stage2Table, dx: number, dy: number) => {
    const result = await api.stage2.tables.updateLayout({ id: table.id, position_x: Math.max(0, table.position_x + dx), position_y: Math.max(0, table.position_y + dy) });
    setNotice(errorText(result) || 'Layout saved');
    await refreshTables();
  };
  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData('text/table-id'));
    const table = visibleTables.find(candidate => candidate.id === id);
    const canvas = event.currentTarget.getBoundingClientRect();
    if (!table) { return; }
    const positionX = Math.max(0, Math.round(event.clientX - canvas.left - table.width / 2));
    const positionY = Math.max(0, Math.round(event.clientY - canvas.top - table.height / 2));
    const result = await api.stage2.tables.updateLayout({ id, position_x: positionX, position_y: positionY });
    setNotice(errorText(result) || 'Layout saved');
    await refreshTables();
  };

  return (
    <div className="container-responsive space-y-5 p-6">
      {notice && <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800" role="status">{notice}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-gray-900">Tables and floor layout</h1><p className="text-sm text-gray-500">Manage dining areas, identifiers, statuses, capacities, and saved positions.</p></div><Button variant="outline" onClick={() => { navigate('/order/0'); }}>Open order screen</Button></div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-gray-900">Dining areas</h2><Button size="sm" variant="ghost" onClick={resetAreaForm}>New</Button></div>
          <form onSubmit={(event) => { void saveArea(event); }} className="mb-4 space-y-2"><Input label={areaId ? 'Edit area' : 'New area'} value={areaName} onChange={event => { setAreaName(event.target.value); }} placeholder="Main hall" required /><Input label="Sort order" type="number" min="0" value={areaSortOrder} onChange={event => { setAreaSortOrder(event.target.value); }} /><div className="flex gap-2"><Button type="submit">Save</Button>{areaId && <Button type="button" variant="ghost" onClick={resetAreaForm}>Cancel</Button>}</div></form>
          <div className="space-y-2">{areas.length === 0 ? <p className="text-sm text-gray-500">No dining areas yet.</p> : areas.map(area => <div key={area.id} className={`rounded-lg border p-2 ${selectedAreaId === area.id ? 'border-blue-400 bg-blue-50' : 'border-gray-100'} ${!area.is_active ? 'opacity-60' : ''}`}><button type="button" className="w-full text-left" onClick={() => { setSelectedAreaId(area.id); }}><b>{area.name}</b><span className="ml-2 text-xs text-gray-500">{area.is_active ? 'Active' : 'Inactive'}</span></button><div className="mt-2 flex gap-3 text-xs"><button type="button" className="text-blue-600" onClick={() => { editArea(area); }}>Edit</button><button type="button" className="text-gray-600" onClick={() => { void toggleArea(area); }}>{area.is_active ? 'Deactivate' : 'Activate'}</button></div></div>)}</div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold text-gray-900">Tables in {selectedArea?.name ?? 'selected area'}</h2><p className="text-xs text-gray-500">Identifiers must be unique within their dining area. Deactivation preserves history.</p></div><Button size="sm" variant="ghost" onClick={resetTableForm}>New table</Button></div>
          <form onSubmit={(event) => { void saveTable(event); }} className="mb-5 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4"><Input label="Identifier" value={tableForm.identifier} onChange={event => { setTableForm(current => ({ ...current, identifier: event.target.value })); }} placeholder="T-01" required /><Input label="Display name" value={tableForm.name} onChange={event => { setTableForm(current => ({ ...current, name: event.target.value })); }} placeholder="Optional" /><Input label="Capacity" type="number" min="1" value={tableForm.capacity} onChange={event => { setTableForm(current => ({ ...current, capacity: event.target.value })); }} required /><Select label="Default status" value={tableForm.status} onChange={event => { setTableForm(current => ({ ...current, status: event.target.value as Stage2TableStatus })); }}>{statuses.map(status => <option key={status} value={status}>{status}</option>)}</Select><Select label="Shape" value={tableForm.shape} onChange={event => { setTableForm(current => ({ ...current, shape: event.target.value as Stage2TableShape })); }}><option value="rectangle">Rectangle</option><option value="round">Round</option></Select><Input label="Width" type="number" min="48" value={tableForm.width} onChange={event => { setTableForm(current => ({ ...current, width: Number(event.target.value) })); }} /><Input label="Height" type="number" min="40" value={tableForm.height} onChange={event => { setTableForm(current => ({ ...current, height: Number(event.target.value) })); }} /><div className="flex items-end gap-2"><Button type="submit">{tableForm.id ? 'Update' : 'Add table'}</Button>{tableForm.id && <Button type="button" variant="ghost" onClick={resetTableForm}>Cancel</Button>}</div></form>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleTables.length === 0 ? <p className="text-sm text-gray-500">No tables in this area yet.</p> : visibleTables.map(table => <div key={table.id} className={`rounded-lg border p-3 ${!table.is_active ? 'opacity-60' : ''}`}><div className="flex items-start justify-between gap-2"><div><b className="text-gray-900">{table.identifier}</b><p className="text-xs text-gray-500">{table.name} · {table.capacity} seats</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${statusStyles[table.status]}`}>{table.status}</span></div><div className="mt-3 flex items-center gap-2"><select aria-label={`Status for ${table.identifier}`} className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs" value={table.status} disabled={!table.is_active} onChange={event => { void updateStatus(table, event.target.value as Stage2TableStatus); }}>{statuses.map(status => <option key={status} value={status}>{status}</option>)}</select><button type="button" className="text-xs text-blue-600" onClick={() => { editTable(table); }}>Edit</button><button type="button" className="text-xs text-gray-600" onClick={() => { void toggleTable(table); }}>{table.is_active ? 'Off' : 'On'}</button></div><div className="mt-2 flex gap-3 text-xs"><button type="button" className="text-gray-600" onClick={() => { setSelectedTableId(table.id); }}>Focus floor</button><button type="button" className="text-blue-600" onClick={() => { navigate(`/order/${table.id}`); }}>Open order</button></div></div>)}</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold text-gray-900">Visual floor layout</h2><p className="text-xs text-gray-500">Drag a table onto the canvas to save its position, or use the nudge controls.</p></div><div className="flex flex-wrap gap-2 text-xs">{statuses.map(status => <span key={status} className={`rounded-full border px-2 py-1 ${statusStyles[status]}`}>{status}</span>)}</div></div>
        <div className="relative h-[520px] overflow-auto rounded-lg border border-dashed border-gray-300 bg-[linear-gradient(to_right,#e5e7eb_1px,transparent_1px),linear-gradient(to_bottom,#e5e7eb_1px,transparent_1px)] bg-[size:24px_24px]" onDragOver={event => { event.preventDefault(); }} onDrop={(event) => { void handleDrop(event); }}>
          {visibleTables.map(table => <div key={table.id} draggable={table.is_active} onDragStart={event => { event.dataTransfer.setData('text/table-id', String(table.id)); }} className={`absolute flex cursor-move flex-col items-center justify-center rounded-lg border-2 p-2 text-center shadow-sm ${statusStyles[table.status]} ${table.shape === 'round' ? 'rounded-full' : ''} ${selectedTableId === table.id ? 'ring-2 ring-blue-600 ring-offset-2' : ''}`} style={{ left: table.position_x, top: table.position_y, width: table.width, height: table.height, transform: `rotate(${table.rotation}deg)` }} onClick={() => { setSelectedTableId(table.id); }}><b className="text-sm">{table.identifier}</b><span className="text-[10px]">{table.capacity} seats</span><div className="mt-1 flex gap-1" onClick={event => { event.stopPropagation(); }}><button type="button" className="rounded bg-white/70 px-1 text-[10px]" onClick={() => { void moveTable(table, -12, 0); }} aria-label={`Move ${table.identifier} left`}>←</button><button type="button" className="rounded bg-white/70 px-1 text-[10px]" onClick={() => { void moveTable(table, 12, 0); }} aria-label={`Move ${table.identifier} right`}>→</button><button type="button" className="rounded bg-white/70 px-1 text-[10px]" onClick={() => { void moveTable(table, 0, -12); }} aria-label={`Move ${table.identifier} up`}>↑</button><button type="button" className="rounded bg-white/70 px-1 text-[10px]" onClick={() => { void moveTable(table, 0, 12); }} aria-label={`Move ${table.identifier} down`}>↓</button></div></div>)}
          {visibleTables.length === 0 && <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">Add a table to start arranging the floor.</p>}
        </div>
      </Card>
    </div>
  );
};

export default TablesPage;
