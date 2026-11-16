import { phones } from './import.mjs';

export function driverMessage(order) {
  const contacts = (order.contacts || []).filter(contact => contact.role === 'Водитель');
  const [phone] = contacts.flatMap(contact => contact.values).flatMap(phones);
  const formattedPhone = phone?.replace(/^(\+7\d{3})(\d{3})(\d{2})(\d{2})$/, '$1-$2-$3-$4');
  const segments = (order.vehicle || '').split(/\s*·\s*/).map(part => part.trim()).filter(Boolean);
  // PDF stores brand, tractor number and optional trailer as separated parts.
  const trailer = segments.length >= 3 ? segments.at(-1) : '';
  const vehicle = (trailer ? segments.slice(0, -1) : segments).join(' ');
  const value = text => text?.replace(/\s+/g, ' ').trim() || '—';
  return [
    'Данные на водителя:',
    'ФИО: ' + value(order.driver),
    'Паспорт: ' + value(order.passport),
    'Транспорт: ' + value(vehicle),
    ...(trailer ? ['Прицеп: ' + trailer] : []),
    'Номер телефона: ' + value(formattedPhone),
  ].join('\n');
}
