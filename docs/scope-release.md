Scope de Release — Radiografía Financiera

Fecha de lanzamiento: 12 de septiembre de 2026 Congelado el: 11 de agosto de 2026

Contexto crítico

La Radiografía vive dentro del repo de LifePlan BudgetApp, comparte build de Vite y despliegue, y hoy está mezclada con módulos existentes.

La BudgetApp no se lanza el 12 de septiembre. Es un SaaS autenticado, con Stripe y OAuth, a medio terminar. Publicar la Radiografía sin aislarla significa publicar la BudgetApp entera y dejarla alcanzable por cualquiera que escriba /dashboard en la barra de direcciones.

De ahí la Épica 0, que es bloqueante para todo lo demás.

Definición de "Listo"

La release está lista cuando estas 8 cosas son verdad. Ni una más.

En producción, ninguna ruta ni endpoint de la BudgetApp es alcanzable. El único producto público es la Radiografía.
Un usuario sin extracto bancario puede completar la radiografía a mano, desde el móvil, en menos de 4 minutos.
Al terminar, ve su resultado en pantalla y puede pedir el informe completo dejando su email.
El email y el resultado quedan persistidos, y el informe personalizado llega automáticamente en HTML con enlace a la versión web.
El eBook "De la ansiedad a la paz financiera" se entrega como enlace de descarga en ese mismo email.
luisvespa.com muestra una página inicial mínima con CTA a la radiografía.
Todo desplegado en producción, con dominio y subdominio funcionando y correo autenticado (SPF/DKIM/DMARC).
Tres personas ajenas al proyecto completaron el flujo completo de punta a punta sin ayuda tuya.
FUERA DE SCOPE — leer esto antes de tocar código

Estas ideas van a aparecer entre el 20 de agosto y el 10 de septiembre y van a parecer imprescindibles. No lo son. Van a v2.md.

Cuentas de usuario, login, historial de radiografías
Dashboard o panel de seguimiento
El sistema interactivo de planificación de ahorros e inversiones
PDF generado en servidor
Comparación con otros usuarios / benchmarks
Multi-moneda o multi-idioma
Integración bancaria automática (Open Banking)
Recalcular o editar una radiografía ya enviada
Secuencia de nutrición de más de 1 email
Rediseño del cálculo de la Épica 2, que ya está terminado
Cualquier trabajo en módulos de la BudgetApp. No se lanza el 12 de septiembre. Tocarla ahora no aporta nada a esta fecha.
Guardar importes financieros en bruto (ver decisión de privacidad en la Épica 2)

Regla: si una tarea no aparece en las Épicas 1, 2 o 3 de abajo, no se hace antes del 12 de septiembre.

ÉPICA 0 — Aislar la Radiografía de la BudgetApp

Bloqueante. Se hace primero. Su coste sube cada día que se posterga, porque cada avance de la Épica 1 se construye encima de la mezcla actual. Es la única tarea del proyecto con esa propiedad.

Estimación realista con el código mezclado: 1 a 1,5 días.

Tareas

1. Carpeta propia

Mover todo lo de la Radiografía a src/radiografia/
Cortar los imports cruzados: src/radiografia/ puede importar del sistema de diseño compartido (components/ui, tokens, i18n) y nunca de módulos de la BudgetApp
Los módulos de la BudgetApp nunca importan de src/radiografia/
Esa regla de dirección única es lo que evita que se vuelvan a enredar

2. Interruptor de producto en el frontend

VITE_ENABLE_BUDGETAPP — en producción va en false
Con el flag apagado, las rutas de la BudgetApp no se registran en el router. No es ocultar un enlace del menú: es que la ruta no exista en el bundle de producción
En local se trabaja con true y todo sigue igual

3. Interruptor en el backend

Las rutas de la BudgetApp no se montan si el flag está apagado
/api/plans debe devolver 404, no un 401 — un 401 confirma que ahí hay algo

4. Rutas públicas explícitas

La convención general del proyecto es que toda ruta usa requireAuth
Los endpoints de la Radiografía son la única excepción y deben estar listados de forma explícita y visible, no como excepción implícita

5. Indexación

robots.txt permitiendo solo landing, radiografía y página del informe
noindex en todo lo demás
Criterios de aceptación
 Con el flag apagado, /dashboard, /login, /plans y /allocations devuelven 404
 Con el flag apagado, /api/plans y el resto de endpoints de la BudgetApp devuelven 404
 La Radiografía funciona de punta a punta con el flag apagado
 Con el flag encendido en local, la BudgetApp sigue funcionando igual que hoy
 Ningún archivo de src/radiografia/ importa de un módulo de la BudgetApp
 robots.txt verificado en producción
ÉPICA 1 — Radiografía manual (sin extracto bancario)

Objetivo: que la falta de extracto bancario deje de ser un motivo de abandono.

Principios de diseño
Móvil primero. Se diseña a 380px y luego se adapta a escritorio.
Un paso por pantalla, con barra de progreso. Menos intimidante que un formulario largo.
Montos mensuales aproximados. Todos los campos dicen explícitamente "aproximado" — quitar la presión de la exactitud es lo que hace que la gente termine.
Sin email hasta el resultado. Cero fricción antes del diagnóstico.
Que el total pueda superar el ingreso. Esto NO es un error de validación: es el hallazgo más valioso del informe. Nunca bloquear el avance por esto.
Pasos del formulario

Paso 1 — Ingreso

Ingreso mensual neto (obligatorio, > 0)
Microcopy: "Lo que realmente entra a tu cuenta cada mes, después de impuestos."

Paso 2 — Vivienda

Selector: ¿Hipoteca / Alquiler / Ninguno (vivienda propia sin deuda o no pago)?
Campo condicional según la elección: cuota mensual de hipoteca o alquiler mensual
Se pregunta aparte para evitar el doble conteo con gastos esenciales

Paso 3 — Gastos esenciales

Monto mensual aproximado
Microcopy explícito: "Sin contar vivienda ni cuotas de deuda, que ya preguntamos aparte. Aquí van comida, transporte, servicios, seguros, salud."
El doble conteo es el error #1 en formularios de este tipo y destruye la credibilidad del informe

Paso 4 — Disfrute

Gastos en diversión y ocio, monto mensual aproximado
Microcopy: "Restaurantes, suscripciones, salidas, compras que no son necesidad. Sé honesto, nadie más lo va a ver."

Paso 5 — Ahorro, inversión y generosidad

Ahorro mensual
Inversión mensual
Donaciones / diezmo mensual
Los tres en una pantalla: son los tres que la gente suele tener en 0, y agruparlos evita tres pantallas seguidas de cero

Paso 6 — Deudas y compromisos de pago

Lista dinámica con botón "Añadir deuda"
Por cada deuda: tipo (tarjeta de crédito / préstamo personal / préstamo de coche / otra), cuota mensual, saldo total pendiente (opcional)
La hipoteca del Paso 2 se arrastra automáticamente aquí, no se vuelve a pedir
Botón claro de "No tengo deudas" para saltar el paso

Paso 7 — Resultado

Desglose por área en porcentaje del ingreso
Contraste con el marco 10/50/20/20
El número incómodo: dinero sin asignar, o déficit mensual si los gastos superan el ingreso
CTA al informe completo + eBook
Criterios de aceptación
 Se completa en móvil en menos de 4 minutos
 Todos los campos numéricos aceptan 0 y muestran separador de miles
 Total acumulado visible en todo momento, comparado con el ingreso
 Se puede volver atrás sin perder lo ya introducido
 El estado sobrevive a un refresco accidental de la página
 Ninguna combinación de datos rompe el cálculo del resultado (probar: todo en 0, gastos = 3x ingreso, sin deudas, 8 deudas)
 Un usuario que llega por el flujo de extracto bancario ve un enlace visible a "no tengo mi extracto, hacerlo a mano"
ÉPICA 2 — Informe personalizado y entrega

Estado: el cálculo y la radiografía están terminados. Falta la persistencia, el generador del informe y la entrega.

Persistencia — no estaba contabilizada y es bloqueante

Hoy la Radiografía calcula, muestra y ahí muere: no guarda nada. Pero el propósito del embudo es capturar emails, y la página permanente del informe necesita algo que servir en esa URL. Sin persistencia no hay Épica 2. Medio día.

Tabla nueva en Prisma (algo como Radiografia):

Campo	Notas
id	Token no adivinable, usado en la URL del informe
email	
consentimiento	Booleano + timestamp
resultado	JSON: porcentajes por área y umbrales activados
createdAt	
origen	Valor del utm_source, para cruzar con la analítica

Decisión de privacidad: guarda los porcentajes y el diagnóstico, no los importes en bruto.

El informe solo necesita los porcentajes por área y qué umbrales se activaron. No almacenando cuánto gana exactamente cada persona ni cuánto debe, reduces mucho la exposición: menos daño si hay una filtración, menos obligaciones de RGPD, y la conversación de privacidad se vuelve trivial. No hay ninguna razón de negocio para guardar el salario de nadie.

Los importes viven solo en memoria del navegador durante la sesión del formulario.

Endpoint: POST /api/radiografia — público, sin requireAuth, con limitación de tasa por IP.

Decisión técnica: HTML, no PDF

Email HTML con el informe dentro + enlace permanente a la versión web del mismo informe. En la versión web, un botón "Guardar como PDF" que usa window.print() con CSS de impresión.

Motivos: nada de infraestructura de generación de PDF, mejor entregabilidad para un dominio nuevo, se lee bien en móvil, y los clics son medibles. PDF real generado en servidor → v2.

El eBook se entrega como enlace de descarga, nunca como adjunto.

Contenido del informe
Titular — el diagnóstico en una frase, personalizado según el resultado
Tu dinero en porcentajes — desglose por área con barras visuales
Contraste con el marco 10/50/20/20 — dónde estás por encima y por debajo
Los huecos — 2 o 3 fugas concretas detectadas, en lenguaje directo
Presión de deuda — cuota total mensual como % del ingreso, con umbral de alarma
Tres pasos siguientes — accionables esta semana, no genéricos
CTA al eBook — como el paso natural, no como un anuncio pegado al final

Reglas de tono: sin culpa ni sermón. Diagnóstico honesto, no juicio. El marco de mayordomía se siente en el lenguaje, no se cita en cada párrafo.

Implementación
Plantilla HTML con tablas y CSS inline (los clientes de correo no soportan CSS moderno)
Texto condicional por umbrales, no un párrafo genérico para todos: el informe tiene que sentirse escrito para esa persona
Versión de texto plano alternativa (mejora la entregabilidad y evita filtros de spam)
Proveedor de envío: Resend, Brevo o MailerLite — cualquiera sirve, elige el que configures en menos de una hora
Página permanente del informe en URL con token no adivinable
CSS @media print en esa página + botón de guardar como PDF
Cumplimiento (no lo saltes)
 Casilla de consentimiento explícita, sin premarcar, antes de capturar el email
 Enlace a política de privacidad
 Enlace de baja en el pie del email
 SPF, DKIM y DMARC configurados en el dominio
Criterios de aceptación
 El informe llega en menos de 2 minutos tras dejar el email
 Se ve correctamente en Gmail móvil, Gmail escritorio, Outlook y Apple Mail
 Dos perfiles financieros muy distintos generan informes claramente distintos
 El enlace del eBook descarga el archivo correcto
 El enlace permanente del informe funciona en ventana de incógnito
 No cae en spam en tres cuentas de prueba de proveedores distintos
 Si el envío falla, el usuario ve un mensaje claro y el informe sigue accesible en pantalla
ÉPICA 3 — Página inicial de luisvespa.com

Objetivo: que quien escriba el dominio directamente entienda en 10 segundos quién eres y termine en la radiografía.

Alcance recortado: tres secciones. Sin blog, sin sección de servicios, sin formulario de contacto.

El recorte es deliberado, para que quepa la Épica 0. El 12 de septiembre casi nadie llega a luisvespa.com directamente: llegan por el enlace de la radiografía. La landing es para el tráfico que viene después, y se amplía en octubre.

Secciones
Hero — tu nombre, una frase de posicionamiento, tu foto real, CTA a la radiografía
El por qué — 2 párrafos en primera persona. Tu historia, no una biografía corporativa. Esta es la sección que construye confianza en un nicho de fe.
CTA final + pie — enlace a la radiografía, redes, política de privacidad, aviso legal

A v2: "para quién es", captura de la herramienta, testimonios.

Sobre autenticidad: en 2026 la cara y la voz humanas reales son un diferenciador de valor, no un detalle. Foto real, historia real, nada de imágenes de banco genéricas.

Criterios de aceptación
 Carga en menos de 2 segundos en 4G
 Perfecta en móvil
 Metadatos Open Graph correctos (título, descripción, imagen) para cuando compartas el enlace
 Favicon
 El CTA a la radiografía aparece al menos dos veces
 Analítica instalada (ver Épica 4)
 Certificado HTTPS activo en dominio y subdominio
Calendario — 32 días
Fechas	Foco	Entregable al cerrar
11–13 ago	Épica 0: aislar	Rutas de la BudgetApp devuelven 404 en producción
14–20 ago	Épica 1: formulario manual	Formulario completo y funcional en local
21–27 ago	Épica 2 (persistencia + informe + entrega) y Épica 4	Emails llegando a bandejas reales, eventos en el panel
28 ago – 3 sep	Video de lanzamiento y shorts	Todo grabado y editado
4–8 sep	Épica 3 + copy + programación	Landing en vivo, posts programados
9–11 sep	Margen y pruebas de terceros	Nada nuevo. Solo arreglar.
12 sep	Lanzamiento	

Lo técnico va primero porque es lo único que puede bloquear todo lo demás. Los días 9 al 11 no se planifican: siempre se rompe algo.

El calendario está apretado. Si algo se retrasa, lo que cede es la landing de la Épica 3 (puede reducirse a solo el hero y el CTA), no la Épica 0 ni el margen final.

ÉPICA 4 — Medición

Sin esto, el 13 de septiembre no sabrás si el lanzamiento funcionó ni qué arreglar. Son unas 3–4 horas de trabajo y encajan en la semana del 18 al 24 de agosto, junto a la Épica 2.

Las cuatro métricas
Visitas al enlace
% que completa la radiografía
% que deja el email por el informe
% que hace clic en el enlace del eBook

Si el abandono grande está entre 1 y 2, el formulario es demasiado largo. Si está entre 2 y 3, el resultado en pantalla no genera suficiente incomodidad.

Herramienta: Plausible (no Google Analytics)

Plausible no usa cookies ni recoge datos personales, así que no necesitas banner de consentimiento. GA4 en Europa sí, y ese banner cuesta entre un 10 y un 30% de las visitas registradas — justo la métrica 1. Unos 9€/mes. Alternativa gratuita: Umami autoalojado.

Se instala en la landing (luisvespa.com) y en el subdominio de la radiografía, configurado para tratar ambos como el mismo sitio.

Eventos personalizados
Evento	Se dispara cuando	Sirve para
radiografia_vista	Carga de página (automático)	Denominador
radiografia_iniciada	Se rellena el primer campo	Separa "no le interesó" de "se cansó"
paso_completado	Al avanzar de paso, con el nº de paso como propiedad	El más útil: dice en qué pantalla exacta se cae la gente
radiografia_completada	Se renderiza la pantalla de resultado	Métrica 2
email_capturado	El envío del informe se confirma OK	Métrica 3

En Plausible es una línea por evento: plausible('radiografia_completada').

UTM desde el primer enlace publicado

Todo enlace que publiques lleva etiqueta de origen: ?utm_source=youtube, ?utm_source=linkedin, ?utm_source=instagram, ?utm_source=whatsapp. Sin esto verás 300 visitas sin saber de dónde vinieron, y no podrás decidir dónde concentrar el esfuerzo la semana siguiente.

Métrica 4: desde el proveedor de email

No se construye, ya viene en el panel de Resend / Brevo / MailerLite. Solo hay que activar el seguimiento de clics al configurar la plantilla.

No te fíes de la tasa de apertura. Apple Mail Privacy Protection precarga el píxel de seguimiento aunque el usuario nunca abra el correo, así que las aperturas vienen infladas de forma impredecible. El número real es el clic en el enlace del eBook: ahí hubo una decisión deliberada.

Dónde se miran

Una hoja de cálculo, revisada una vez por semana. Cinco columnas: fecha, visitas, completadas, emails, clics al eBook. Sin dashboard, sin panel de administración — eso es v2.

Regla de interpretación

Con menos de 100–150 visitas acumuladas, los porcentajes son ruido. 40 visitas y 8 completadas no es "20% de conversión", es una muestra sin significado. No rediseñes nada el día 13 de septiembre. Espera a acumular volumen suficiente, probablemente hacia el 22 de septiembre.

Criterios de aceptación
 Plausible registrando visitas en landing y subdominio
 Los cinco eventos aparecen en el panel al hacer una prueba completa del flujo
 paso_completado registra correctamente el número de paso
 Seguimiento de clics activado en el proveedor de email
 Enlaces con UTM preparados para YouTube, LinkedIn, Instagram y WhatsApp
 Hoja de cálculo creada con las cinco columnas