import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App'; // Importa el componente principal de la app

// Crea una raíz de React y la vincula al elemento con id="root"
const root = ReactDOM.createRoot(document.getElementById('root'));

// Renderiza el componente principal de la app
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
