import { phones } from './import.mjs';

export function driverMessage(order) {
  const contacts = (order.contacts || []).filter(contact => contact.role === 'Водитель');
  const [phone] = contacts.flatMap(contact => contact.values).flatMap(phones);
  const formattedPhone = phone?.replace(/^(\+7\d{3})(\d{3})(\d{2})(\d{2})$/, '$1-$2-$3-$4');
  const vehicle = order.vehicle?.replace(/\s*·\s*/g, ' ');
  const value = text => text?.replace(/\s+/g, ' ').trim() || '—';
  return [
    'Данные на водителя:',
    'ФИО: ' + value(order.driver),
    'Паспорт: ' + value(order.passport),
    'Транспорт: ' + value(vehicle),
    'Номер телефона: ' + value(formattedPhone),
  ].join('\n');
}
