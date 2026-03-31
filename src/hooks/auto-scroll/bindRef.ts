import { MutableRefObject, Ref } from 'react';

export const bindRef = <T extends HTMLElement>(...refs: Ref<T>[]) => {
  return (element: T | null) => {
    refs.forEach((ref) => {
      if (typeof ref === 'function') {
        ref(element);
      } else if (ref != null) {
        (ref as MutableRefObject<T | null>).current = element;
      }
    });
  };
};
