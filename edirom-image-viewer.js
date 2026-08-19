/**
 * Custom Web Component for viewing IIIF images using the OpenSeadragon viewer.
 * 
 * <edirom-image-viewer> provides an interface to load, view, and interact with IIIF images
 * using the OpenSeadragon JavaScript library. It supports dynamic attribute changes, zooming,
 * page navigation, rotation, and various viewer controls.
 * 
 * @class
 * @extends HTMLElement
 * 
 * @example
 * <edirom-image-viewer tilesources='["manifest.json"]'></edirom-image-viewer>
 * 
 * @attribute {string} tilesources - JSON string array of IIIF manifest URLs or tile source objects.
 *   A tile source object of the shape {type:'digilib', url, width, height} is resolved into a real
 *   OpenSeadragon custom tile source that requests region-scaled tiles from a digilib Scaler endpoint.
 * @attribute {number} pagenumber - The current page/image number to display (for multi-image sequences).
 * @attribute {number} zoom - The zoom level for the viewer.
 * @attribute {number} rotation - The rotation angle in degrees (0-360).
 * @attribute {boolean} preserveviewport - Whether to preserve viewport when changing pages.
 * @attribute {boolean} clicktozoom - Enable/disable click-to-zoom functionality.
 * @attribute {number} minzoomlevel - Minimum allowed zoom level.
 * @attribute {number} maxzoomlevel - Maximum allowed zoom level.
 * @attribute {boolean} shownavigationcontrol - Show/hide all navigation controls.
 * @attribute {boolean} sequencemode - Enable sequence mode for multiple images.
 * @attribute {boolean} shownavigator - Show/hide the navigator mini-map.
 * @attribute {boolean} showzoomcontrol - Show/hide zoom in/out buttons.
 * @attribute {boolean} showhomecontrol - Show/hide the home/reset button.
 * @attribute {boolean} showfullpagecontrol - Show/hide the fullscreen toggle button.
 * @attribute {boolean} showsequencecontrol - Show/hide previous/next page buttons.
 * @attribute {string} triggerhome - Trigger attribute to reset view to home position.
 * @attribute {string} triggerfullscreen - Trigger attribute to toggle fullscreen mode.
 * @attribute {object|string} openseadragon-options - Additional OpenSeadragon configuration options as JSON object.
 * 
 * @attribute {string} zones-data - JSON object mapping zone keys to zone objects.
 *   Each zone: { type: string, page?: number, ulx?: number, uly?: number,
 *   lrx?: number, lry?: number, containerClass?: string, innerClass?: string,
 *   label?: string, group?: string, title?: string, tooltip?: string,
 *   fn?: string, dataId?: string, filters?: string }. `filters` is a
 *   space-separated list of opaque filter tokens used by `hidden-filters`.
 *   The `type` is an opaque string the host assigns (e.g. "measure", "mdiv",
 *   "annotation"). A single map drives BOTH navigation and overlay rendering,
 *   so the component is independent of any source format (MEI, TEI, …).
 * @attribute {string} zone - Key of the zone to navigate to (must exist in zones-data).
 *   An optional trailing "|nonce" is stripped before lookup so that repeating
 *   the same zone still re-fires attributeChangedCallback.
 * @attribute {string} visible-types - JSON array of zone `type`s to render as
 *   visible overlays (e.g. ["annotation"]). [] / absent renders nothing;
 *   navigation is unaffected by this set.
 * @attribute {string} hidden-filters - JSON array of opaque filter tokens to
 *   hide. A rendered overlay is hidden when any of its zone's `filters` tokens
 *   is in this set. [] / absent hides nothing. The host maps its own
 *   taxonomies (e.g. annotation categories/priorities) onto these tokens.
 * 
 * @fires communicate-[property]-update - Fired when a property is updated via attribute change.
 * @fires page-changed - Fired when the viewer navigates to a new page. detail: { pageNumber } (1-based).
 * @fires zone-changed - Fired when the viewer navigates to a zone. detail: { zoneKey, zone }.
 * 
 * @method nextPage - Navigate to the next page in a sequence.
 * @method previousPage - Navigate to the previous page in a sequence.
 * @method goToPage - Navigate to a specific page number.
 * @method getCurrentPage - Get the current page number.
 * @method getTotalPages - Get the total number of pages.
 * @method zoomIn - Zoom in by 20%.
 * @method zoomOut - Zoom out by 20%.
 * @method setZoom - Set zoom to a specific level.
 * @method getZoom - Get the current zoom level.
 * @method home - Reset view to initial state.
 * @method setFullScreen - Set fullscreen mode on/off.
 * @method toggleFullScreen - Toggle fullscreen mode.
 * @method isFullScreen - Check if in fullscreen mode.
 * @method rotate - Rotate by specified degrees.
 * @method setRotation - Set rotation to specific angle.
 * @method getRotation - Get current rotation angle.
 */
class EdiromOpenseadragon extends HTMLElement {
    /**
     * Creates an instance of EdiromOpenseadragon.
     * @constructor
     */
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        console.log("Constructor called");

        /** @type {OpenSeadragon.Viewer} OpenSeadragon viewer instance */
        this.openSeaDragon = null;
        
        /** @type {number} Total number of tile sources (images/pages) */
        this.totalTileSources = 0;
        
        /**
         * @type {Object} Zone lookup map parsed from the zones-data attribute.
         * Keyed by an arbitrary zone key; each entry is a region that carries a
         * `type` (an opaque string such as 'measure', 'mdiv' or 'annotation')
         * plus an optional 1-based `page`, optional image-pixel coordinates
         * {ulx, uly, lrx, lry} and optional render metadata (containerClass,
         * innerClass, label, group, title, tooltip, fn, dataId, filters). A
         * single map drives BOTH region navigation (via the `zone`
         * attribute) and overlay rendering, so the component stays independent
         * of any particular data format (MEI, TEI, …): the host decides what
         * each zone means through its `type` and the CSS classes it supplies.
         */
        this._zonesData = {};

        /**
         * @type {?Array<string>} Zone types that should be rendered as visible
         * overlays, pushed via the `visible-types` attribute. null / [] means
         * render nothing; e.g. ['annotation'] renders annotation zones only.
         * Navigation is independent of this set (any zone can be navigated to
         * regardless of whether its type is rendered).
         */
        this._visibleTypes = [];

        /**
         * @type {Object<string,HTMLElement>} group-keyed shared overlay
         * containers for the currently rendered zones. Zones sharing a `group`
         * (e.g. several annotations on the same measure) share one container so
         * their inner elements stack instead of overlapping.
         */
        this._overlayContainers = {};

        /**
         * @type {Array<Object>} Flat list of every rendered overlay inner
         * element, each entry { element, containerId, filters }. `filters` is
         * the zone's array of opaque filter tokens. Used by the generic
         * hidden-filters mechanism so overlays can be shown/hidden individually
         * without re-pushing or re-rendering zones-data.
         */
        this._overlayBadges = [];

        /**
         * @type {?HTMLElement} The single reusable overlay tooltip element
         * rendered in the shadow DOM. The host preloads each zone's
         * server-rendered tooltip HTML into the `tooltip` field of its
         * zones-data entry, and the component renders/positions it on hover.
         */
        this._annotTipEl = null;

        /**
         * @type {?number} Pending hide timer for the annotation tooltip, used
         * to add a short grace period so the pointer can travel into the tip.
         */
        this._annotTipHideTimer = null;

        /**
         * @type {?Array<string>} Opaque filter tokens that should be HIDDEN,
         * pushed via the `hidden-filters` attribute. null / [] means "nothing
         * hidden" (show all). A rendered overlay is hidden when ANY of its
         * zone's `filters` tokens is in this set. The component does not know
         * what the tokens mean (categories, priorities, tags, …); the host maps
         * its own taxonomies onto them, keeping the component format-agnostic.
         */
        this._hiddenFilters = null;

        /** @type {string|null} Key of the currently active zone, or null */
        this._currentZoneKey = null;

        /** @type {Object|null} Zone waiting to be applied after an OSD page change completes */
        this._pendingZoneAfterPageChange = null;

        /**
         * @type {Object<string,?string>} Named, freestanding SVG overlay
         * layers for the CURRENT page, pushed via the `layers-data` attribute
         * (host preloads/refetches this per page change). Keyed by an
         * arbitrary layer id (e.g. 'layer-1', 'layer-2', ...); a null value
         * means that layer has no markup on this page. Unlike zones-data,
         * each entry is a whole ready-to-render SVG document (image-pixel
         * viewBox), not a rectangular region.
         */
        this._layersData = {};

        /**
         * @type {Array<string>} Layer ids currently visible, pushed via the
         * `visible-layers` attribute. Toggling only flips visibility on
         * already-rendered containers - no re-render needed.
         */
        this._visibleLayers = [];

        /** @type {Object<string,HTMLElement>} layerId-keyed rendered overlay containers */
        this._layerContainers = {};

        /** @type {object} Additional OpenSeadragon options */
        this.options = this.getAttribute('openseadragon-options') ? 
            JSON.parse(this.getAttribute('openseadragon-options')) : {};
    }

    /**
     * Returns the list of observed attributes for the EdiromOpenseadragon custom element.
     * @static
     * @returns {Array<string>} The list of observed attributes.
     */
    static get observedAttributes() {
        return ['preserveviewport', 'clicktozoom', 'minzoomlevel', 'maxzoomlevel', 'shownavigationcontrol', 'sequencemode', 'shownavigator', 'showzoomcontrol', 'showhomecontrol', 'showfullpagecontrol', 'showsequencecontrol', 'tilesources', 'pagenumber', 'zoom', 'rotation', 'triggerhome', 'triggerfullscreen', 'openseadragon-options', 'zones-data', 'zone', 'visible-types', 'hidden-filters', 'fitrect', 'view-mode', 'layers-data', 'visible-layers'];
    }

    /**
     * Invoked when one of the custom element's attributes is added, removed, or changed.
     * @param {string} property - The name of the attribute that was changed.
     * @param {*} oldValue - The previous value of the attribute.
     * @param {*} newValue - The new value of the attribute.
     */
    attributeChangedCallback(property, oldValue, newValue) {

        // handle property change
        this.set(property, newValue);

    }

    /**
     * Sets the value of a global property and triggers property update events.
     * @param {string} property - The name of the property to set.
     * @param {*} newPropertyValue - The new value to set for the property.
     */
    set(property, newPropertyValue) {
        
        // set internal and html properties  
        this[property] = newPropertyValue;
        
        // custom event for property update
        const event = new CustomEvent('communicate-' + property + '-update', {
            detail: { [property]: newPropertyValue },
            bubbles: true
        });
        this.dispatchEvent(event);

        // further handling of property change
        this.handlePropertyChange(property, newPropertyValue);
    }

    /**
     * Lifecycle callback invoked when the custom element is added to the DOM.
     * Loads the OpenSeadragon library and initializes the viewer container.
     */
    connectedCallback() {
        console.log("Image Viewer connected to DOM!");
        
        // Add host styles
        const style = document.createElement('style');
        style.textContent = `
            :host {
                display: block;
                width: 100%;
                height: 100%;
            }
        `;
        this.shadowRoot.appendChild(style);

        console.log("Connected to DOM");

        // Inject the overlay stylesheets into the shadow root, since main-document
        // class rules do not cross the shadow boundary:
        //   - annotation-style.css : per-category annotIcon glyph rules
        //   - font-awesome.min.css : FontAwesome icon rules used by some annotIcons
        // The Bravura / FontAwesome @font-face declarations are NOT duplicated here:
        // @font-face is resolved document-wide, so the fonts registered by the main
        // page (theme bundle + font-awesome.min.css) are usable by shadow content.
        // That keeps annotation-style.css identical to develop (no font/.hidden dups).
        const cssFiles = [
            'resources/css/annotation-style.css',
            'resources/css/font-awesome.min.css'
        ];
        cssFiles.forEach(href => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            this.shadowRoot.appendChild(link);
        });

        // Also inject the EDITION's own stylesheet — the same one Application.js
        // loads into the document <head> from the 'additional_css_path' preference.
        // Edition-specific annotation styling (e.g. the per-category glyph rules in
        // an edition's annotation-style.css) lives there, and main-document
        // stylesheets do not cross the shadow boundary. Cloning the existing head
        // link keeps this edition-agnostic: any edition that sets additional_css_path
        // gets its CSS applied to the overlays in this shadow root.
        try {
            const cssPref = (typeof getPreference === 'function')
                ? getPreference('additional_css_path', true) : null;
            if (cssPref && cssPref.indexOf('/db/') !== -1) {
                const tail = cssPref.split('/db/')[1];
                const editionLink = Array.prototype.slice
                    .call(document.head.querySelectorAll('link[rel="stylesheet"]'))
                    .find(l => l.href && l.href.indexOf(tail) !== -1);
                if (editionLink) {
                    const clone = document.createElement('link');
                    clone.rel = 'stylesheet';
                    clone.href = editionLink.href;
                    this.shadowRoot.appendChild(clone);
                }
            }
        } catch (e) {
            console.warn('Image Viewer: could not inject edition stylesheet', e);
        }

        // Create a div for the OpenSeadragon viewer
        this.viewerDiv = document.createElement('div');
        this.viewerDiv.id = 'viewer';
        this.viewerDiv.style.width = '100%';
        this.viewerDiv.style.height = '100%';
        this.shadowRoot.appendChild(this.viewerDiv);

        // Load OSD script into document.head so it runs in the global scope
        // (scripts appended to shadow root do not execute). index.html already
        // loads OpenSeadragon locally at page load - only fetch the CDN copy as
        // a fallback when that's missing. Skipping this check used to ALWAYS
        // inject a second, redundant OpenSeadragon build; when that async CDN
        // fetch resolved later it silently replaced window.OpenSeadragon
        // mid-session and re-ran displayOpenSeadragon(), tearing down/rebuilding
        // every already-initialized viewer against the new global (symptom:
        // page navigation stops visually updating even though all the
        // host-side page/attribute state keeps advancing correctly).
        if (window.OpenSeadragon) {
            this.set('tilesources', this.getAttribute('tilesources'));
        } else if (!document.getElementById('osd-script')) {
            const osdScript = document.createElement('script');
            osdScript.id = 'osd-script';
            osdScript.src = "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.1/openseadragon.min.js";
            osdScript.onload = () => {
                if (window.OpenSeadragon) {
                    this.set('tilesources', this.getAttribute('tilesources'));
                }
            };
            document.head.appendChild(osdScript);
        } else {
            // Script tag exists but not yet loaded — wait for it
            document.getElementById('osd-script').addEventListener('load', () => {
                if (window.OpenSeadragon) {
                    this.set('tilesources', this.getAttribute('tilesources'));
                }
            });
        }
    }

    /**
     * Handles property changes for the OpenSeadragon viewer component.
     * Routes property changes to appropriate handler methods or triggers viewer recreation.
     * @param {string} property - The name of the property being changed.
     * @param {any} newPropertyValue - The new value of the property.
     */
    handlePropertyChange(property, newPropertyValue) {
        switch(property) {
      
            // handle tileSources property change
            case 'tilesources':
                this.displayOpenSeadragon();
                // Announce the new page total ONLY when the tile sources actually
                // change (not on the viewer recreations triggered by sequencemode
                // or control-visibility toggles, which reuse the current/stale
                // sources). Fire only for a real, non-empty, changed count so a
                // transient empty/rebuild state never resets host pagination.
                try {
                    const parsedSources = JSON.parse(newPropertyValue);
                    const total = Array.isArray(parsedSources) ? parsedSources.length : 1;
                    if (total > 0 && total !== this._lastAnnouncedTotal) {
                        this._lastAnnouncedTotal = total;
                        this._fireTotalPagesChanged(total);
                    }
                } catch (e) { /* invalid tilesources JSON: nothing to announce */ }
                break;
            
            case 'pagenumber':
                this.goToPage(parseInt(newPropertyValue));
                break;
            
            case 'zoom':
                this.setZoom(parseFloat(newPropertyValue));
                break;
            
            case 'rotation':
                this.setRotation(parseFloat(newPropertyValue));
                break;
            
            case 'triggerhome':
                this.home();
                break;
            
            case 'triggerfullscreen':
                this.toggleFullScreen();
                break;
            
            case 'openseadragon-options':
                this.options = JSON.parse(newPropertyValue);
                if(this.openSeaDragon) {
                    this.displayOpenSeadragon();
                }
                break;

            case 'preserveviewport':
            case 'minzoomlevel':
            case 'maxzoomlevel':
            case 'shownavigationcontrol':
            case 'sequencemode':
            case 'showfullpagecontrol':
            case 'shownavigator':
            case 'showzoomcontrol':
            case 'showhomecontrol':
            case 'showsequencecontrol':
                // These control visibility properties require recreating the viewer
                if(this.openSeaDragon) {
                    this.displayOpenSeadragon();
                }
                break;
            
            case 'clicktozoom':
                if(this.openSeaDragon) {
                    this.openSeaDragon.gestureSettingsMouse.clickToZoom = newPropertyValue === 'true';
                }
                break;

            case 'zones-data':
                try {
                    this._zonesData = JSON.parse(newPropertyValue) || {};
                } catch (e) {
                    console.error('Invalid zones-data JSON:', e);
                    this._zonesData = {};
                }
                // If a zone key is already active, re-apply it against the new data.
                if (this._currentZoneKey) {
                    this._applyZoneByKey(this._currentZoneKey);
                }
                // Re-render the visible overlays for the current page from the
                // new data (annotations, measure labels, …).
                this._renderOverlays();
                break;

            // Jump to a specific zone (by the key used in zones-data). An
            // optional trailing "|nonce" makes repeated jumps to the same zone
            // re-fire this handler; the nonce is stripped before lookup. Host
            // pushes measures / movements / annotations as ordinary zone
            // entries, so this is the single navigation entry point for all
            // region jumps.
            case 'zone': {
                const zoneKey = String(newPropertyValue).split('|')[0];
                // Ignore the empty default value (zone="") set in markup so it
                // does not log a "not found" warning on viewer creation.
                if (zoneKey) this._applyZoneByKey(zoneKey);
                break;
            }

            // Which zone `type`s are rendered as visible overlays (push model,
            // format-independent). The host pushes a JSON array of type strings
            // when the "show annotations" / "show measures" buttons are toggled;
            // [] hides everything. Navigation is unaffected.
            case 'visible-types':
                try {
                    this._visibleTypes = JSON.parse(newPropertyValue) || [];
                } catch (e) {
                    console.error('Invalid visible-types JSON:', e);
                    this._visibleTypes = [];
                }
                this._renderOverlays();
                break;

            // Generic overlay filter (push model). The host pushes the set of
            // filter tokens to HIDE as a JSON array whenever the user toggles a
            // filter menu. A rendered overlay is hidden when any of its zone's
            // `filters` tokens is in the set. The component neither re-pushes
            // zones-data nor re-renders, and re-applies the filter to every
            // freshly rendered page.
            case 'hidden-filters':
                try {
                    this._hiddenFilters = JSON.parse(newPropertyValue);
                } catch (e) {
                    console.error('Invalid hidden-filters JSON:', e);
                    this._hiddenFilters = null;
                }
                this._applyOverlayVisibility();
                this._emitFilterChanged();
                break;

            // Named SVG overlay layers for the current page (push model). The
            // host refetches/pushes this whenever the page changes, keyed by
            // an arbitrary layer id (e.g. 'layer-1', 'layer-2', ...). Rebuilds
            // every layer container from scratch; visibility is applied after.
            case 'layers-data':
                try {
                    this._layersData = JSON.parse(newPropertyValue) || {};
                } catch (e) {
                    console.error('Invalid layers-data JSON:', e);
                    this._layersData = {};
                }
                this._renderLayers();
                break;

            // Which layer ids (from layers-data) are currently checked/visible.
            // Pure visibility toggle - does not rebuild or refetch anything.
            case 'visible-layers':
                try {
                    this._visibleLayers = JSON.parse(newPropertyValue) || [];
                } catch (e) {
                    console.error('Invalid visible-layers JSON:', e);
                    this._visibleLayers = [];
                }
                this._applyLayerVisibility();
                break;

            // Fit the viewport to an image-pixel rectangle. Value format:
            // "x,y,width,height" with an optional trailing nonce token that is
            // ignored — the nonce only exists so that repeating the SAME jump
            // produces a different attribute value and thus re-fires
            // attributeChangedCallback (used for direct rectangle navigation).
            case 'fitrect':
                if (newPropertyValue) {
                    const parts = String(newPropertyValue).split(',');
                    if (parts.length >= 4) {
                        this.fitImageRect(
                            parseFloat(parts[0]), parseFloat(parts[1]),
                            parseFloat(parts[2]), parseFloat(parts[3]));
                    }
                }
                break;

            // Declarative view mode (e.g. 'pageBasedView' / 'measureBasedView').
            // The component records the mode and re-broadcasts it so host code
            // can react; the actual page/measure layout swap is owned by the
            // surrounding ExtJS views.
            case 'view-mode':
                this._viewMode = newPropertyValue;
                this.dispatchEvent(new CustomEvent('view-mode-changed', {
                    detail: { viewMode: newPropertyValue },
                    bubbles: true
                }));
                break;

            // handle default
            default:  
              console.log("Invalid property: '"+property+"'");
      
        }
    
    }

    /**
     * Initializes or reinitializes the OpenSeadragon viewer with current settings.
     * Handles both IIIF manifest URLs and direct tile sources.
     * For IIIF manifests, fetches and parses the manifest to extract image URLs.
     */
    displayOpenSeadragon() {
        if (window.OpenSeadragon) {

            if(this.openSeaDragon) {
                this.openSeaDragon.destroy();
            }

            const tileSources = JSON.parse(this.tilesources);
            
            // Check if it's a IIIF manifest URL (string ending with .json)
            if (Array.isArray(tileSources) && tileSources.length === 1 && 
                typeof tileSources[0] === 'string' && tileSources[0].includes('manifest')) {
                
                // Fetch and parse the IIIF manifest
                fetch(tileSources[0])
                    .then(response => response.json())
                    .then(manifest => {
                        const imageUrls = [];
                        
                        // Extract image info.json URLs from IIIF Presentation API manifest
                        if (manifest.sequences && manifest.sequences[0] && manifest.sequences[0].canvases) {
                            manifest.sequences[0].canvases.forEach(canvas => {
                                if (canvas.images && canvas.images[0] && canvas.images[0].resource) {
                                    const service = canvas.images[0].resource.service;
                                    if (service) {
                                        const serviceId = service['@id'] || service.id;
                                        imageUrls.push(serviceId + '/info.json');
                                    }
                                }
                            });
                        }
                        
                        // Initialize OpenSeadragon with extracted image URLs
                        this.initializeViewer(imageUrls);
                    })
                    .catch(error => {
                        console.error('Error loading IIIF manifest:', error);
                        // Try to load as regular tile sources
                        this.initializeViewer(tileSources);
                    });
            } else {
                // Direct tile sources (not a manifest URL)
                this.initializeViewer(tileSources);
            }
        } else {
            console.error('OpenSeadragon library is not loaded.');
        }
    }
    
    /**
     * Initializes the OpenSeadragon viewer with the provided tile sources.
     * Creates a new viewer instance with all configured options.
     * @param {Array} tileSources - Array of tile source URLs or objects.
     */
    initializeViewer(tileSources) {
        console.log('initializeViewer called with:', tileSources);
        console.log('Viewer div:', this.viewerDiv);
        console.log('OpenSeadragon available:', !!window.OpenSeadragon);
        
        if (!window.OpenSeadragon) {
            console.error('OpenSeadragon library not available');
            return;
        }
        
        try {
            // Store the tile sources count
            this.totalTileSources = Array.isArray(tileSources) ? tileSources.length : 1;

            const resolvedTileSources = Array.isArray(tileSources)
                ? tileSources.map(ts => this._resolveTileSource(ts))
                : this._resolveTileSource(tileSources);

            this.openSeaDragon = OpenSeadragon({
                element: this.viewerDiv,
                prefixUrl: 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.1/images/',
                preserveViewport: this.preserveviewport === 'true',
                minZoomLevel: parseFloat(this.minzoomlevel) || 0.5,
                defaultZoomLevel: parseFloat(this.defaultzoomlevel) || 1,
                maxZoomLevel: parseFloat(this.maxzoomlevel) || 10,
                showNavigationControl: this.shownavigationcontrol === 'true',
                tileSources: resolvedTileSources,
                showNavigator:  this.shownavigator === 'true',
                showZoomControl:  this.showzoomcontrol === 'true',
                showHomeControl:  this.showhomecontrol === 'true',
                showFullPageControl:  this.showfullpagecontrol === 'true',
                showSequenceControl:  this.showsequencecontrol === 'true',
                sequenceMode: this.sequencemode === 'true',
                gestureSettingsMouse: {
                  clickToZoom: this.clicktozoom === 'true',
                },
                // Required for OSD's WebGL drawer to be able to use cross-origin
                // tile images as WebGL textures. Without this, tiles fetched from
                // a different origin are "tainted" and cannot be uploaded to WebGL,
                // causing blank pages on revisit (cached tiles trigger the failure
                // before OSD's canvas-drawer fallback can schedule a redraw).
                crossOriginPolicy: 'Anonymous',
                // Performance and timeout settings
                timeout: 120000, // Increase timeout to 120 seconds for slow servers
                maxImageCacheCount: 200,
                imageLoaderLimit: 2, // Limit concurrent tile requests to reduce server load
                // Merge additional options from openseadragon-options attribute
                ...this.options
            });
            console.log('OpenSeadragon viewer initialized successfully:', this.openSeaDragon);

            // OpenSeadragon's built-in full-page mode reparents the viewer
            // element to <body> and hides the other body children. That breaks
            // inside a shadow DOM: the viewer is torn out of its host/styles and
            // the surrounding layout collapses (only page chrome like a header /
            // footer outside the hidden container survives). Redirect OSD's own
            // full-page button — and our public toggle — to the standard
            // Fullscreen API on the component host, which works in shadow DOM.
            this.openSeaDragon.isFullPage = () => this.isFullScreen();
            this.openSeaDragon.setFullScreen = (fullScreen) => {
                this.setFullScreen(fullScreen);
                return this.openSeaDragon;
            };

            // Re-dispatch OSD zoom changes as a DOM event so host apps can
            // react without reaching into the underlying OpenSeadragon instance.
            this.openSeaDragon.addHandler('zoom', (event) => {
                this.dispatchEvent(new CustomEvent('zoom', {
                    detail: { zoom: event.zoom },
                    bubbles: true
                }));
            });

            // Dispatch an 'image-ready' event once the first tile of the
            // current tile source has been drawn.
            this.openSeaDragon.addOnceHandler('tile-drawn', () => {
                this.dispatchEvent(new CustomEvent('image-ready', { bubbles: true }));
                // Render any overlays/layers that were pushed before the
                // viewer/tiles were ready (placement needs a loaded TiledImage).
                this._renderOverlays();
                this._renderLayers();
            });

            // --- Page change and zone handlers ---
            // Fire page-changed on every OSD page navigation.
            // If a zone was requested for this page, apply it once the new page
            // is shown.
            this.openSeaDragon.addHandler('page', (event) => {
                this._firePageChanged(event.page + 1);

                // Re-render the visible overlays for the new page once its tiles
                // settle. Overlay positions depend on the current TiledImage, so
                // defer until it is available; 'tile-drawn' also fires for cached
                // pages, and the timeout is a fallback after OSD's home reset.
                let rendered = false;
                const renderOverlays = () => {
                    if (rendered) return;
                    rendered = true;
                    this._renderOverlays();
                    this._renderLayers();
                };
                this.openSeaDragon.addOnceHandler('tile-drawn', renderOverlays);
                setTimeout(renderOverlays, 250);

                if (!this._pendingZoneAfterPageChange) return;
                const pending = this._pendingZoneAfterPageChange;
                this._pendingZoneAfterPageChange = null;

                // Apply the region after the new page settles. We can't rely on
                // 'tile-loaded' alone: it does not fire when the target page's
                // tiles are already cached (e.g. a page visited before), which
                // would leave the viewport at the page's home position. Use a
                // one-shot guard fed by both 'tile-drawn' (fires on cached
                // redraws too) and a timeout fallback that also runs after
                // OpenSeadragon's own page-change home reset.
                let applied = false;
                const applyPending = () => {
                    if (applied) return;
                    applied = true;
                    this._applyZone(pending.zone);
                    this._fireRegionChanged(
                        pending.eventName || 'zone-changed',
                        pending.zoneKey, pending.zone);
                };
                this.openSeaDragon.addOnceHandler('tile-drawn', applyPending);
                setTimeout(applyPending, 250);
            });

            // If a zone was requested before the viewer was ready, apply it now.
            // Wait for 'tile-loaded' so coordinate conversion is safe.
            if (this._currentZoneKey && this._zonesData[this._currentZoneKey]) {
                const zone = this._zonesData[this._currentZoneKey];
                const zoneKey = this._currentZoneKey;
                this.openSeaDragon.addOnceHandler('tile-loaded', () => {
                    this._applyZone(zone);
                    this._fireZoneChanged(zoneKey, zone);
                });
            }
        } catch (error) {
            console.error('Error initializing OpenSeadragon:', error);
        }
    }

    /**
     * Turns a plain {type:'digilib', url, width, height} descriptor into a real
     * OpenSeadragon custom tile source: each tile is requested from the digilib
     * Scaler API as a region+scale crop (wx/wy/ww/wh = source region as
     * FRACTIONS 0..1 of the full image - digilib's own convention, see the
     * legacy ImageViewer.calculateHiResImg; dw/dh = absolute pixel destination
     * size), giving true deep-zoom tiling against a server that has no
     * IIIF/DZI endpoint of its own. Any other tile source shape (IIIF
     * descriptor objects, manifest URLs, plain strings) passes through
     * unchanged.
     */
    _resolveTileSource(tileSource) {
        if (!tileSource || tileSource.type !== 'digilib') return tileSource;

        const width = Number(tileSource.width);
        const height = Number(tileSource.height);
        const baseUrl = tileSource.url;
        const tileSize = tileSource.tileSize || 512;
        const sep = baseUrl.includes('?') ? '&' : '?';

        return {
            width,
            height,
            tileSize,
            tileOverlap: 0,
            getTileUrl: function(level, x, y) {
                // `this` is the OpenSeadragon TileSource instance created from
                // this descriptor, so maxLevel/width/height are its own; OSD
                // does NOT keep a plain `tileSize` property on the instance
                // (only internal _tileWidth/_tileHeight), so `tileSize` is
                // read from this closure instead of `this.tileSize`.
                const scale = Math.pow(2, this.maxLevel - level);
                const wxPx = x * tileSize * scale;
                const wyPx = y * tileSize * scale;
                const wwPx = Math.min(tileSize * scale, this.width - wxPx);
                const whPx = Math.min(tileSize * scale, this.height - wyPx);
                const dw = Math.ceil(wwPx / scale);
                const dh = Math.ceil(whPx / scale);
                const wx = wxPx / this.width;
                const wy = wyPx / this.height;
                const ww = wwPx / this.width;
                const wh = whPx / this.height;
                return baseUrl + sep + 'wx=' + wx + '&wy=' + wy + '&ww=' + ww +
                    '&wh=' + wh + '&dw=' + dw + '&dh=' + dh + '&mo=fit';
            }
        };
    }

    /**
     * Public API Methods
     */
    
    /**
     * Zooms in by increasing the current zoom level by 20%.
     */
    zoomIn() {
        if(this.openSeaDragon) {
            const currentZoom = this.openSeaDragon.viewport.getZoom();
            this.openSeaDragon.viewport.zoomTo(currentZoom * 1.2);
        }
    }
    
    /**
     * Zooms out by decreasing the current zoom level by 20%.
     */
    zoomOut() {
        if(this.openSeaDragon) {
            const currentZoom = this.openSeaDragon.viewport.getZoom();
            this.openSeaDragon.viewport.zoomTo(currentZoom / 1.2);
        }
    }
    
    /**
     * Sets the zoom level to a specific value.
     * @param {number} zoomLevel - The desired zoom level.
     */
    setZoom(zoomLevel) {
        if(this.openSeaDragon && !isNaN(zoomLevel)) {
            const viewport = this.openSeaDragon.viewport;
            // Clamp the target to the configured min/max zoom, then let OSD's
            // animated spring ease to it. The clamp is mostly a guard — the
            // spring would constrain the value anyway — but it keeps the bound
            // explicit and protects against embeddings where the animation loop
            // never runs and the constraint would never be applied.
            const clampedZoom = Math.max(
                viewport.getMinZoom(),
                Math.min(zoomLevel, viewport.getMaxZoom()));
            viewport.zoomTo(clampedZoom);
        }
    }
    
    getZoom() {
        return this.openSeaDragon ? this.openSeaDragon.viewport.getZoom() : 0;
    }
    
    // Page navigation methods
    nextPage() {
        if(this.openSeaDragon) {
            this.openSeaDragon.goToNextPage();
        }
    }
    
    previousPage() {
        if(this.openSeaDragon) {
            this.openSeaDragon.goToPreviousPage();
        }
    }
    
    goToPage(pageNumber) {
        if(this.openSeaDragon && !isNaN(pageNumber)) {
            // pagenumber is 1-based, but OpenSeadragon's goToPage expects a 0-based index
            const targetIndex = pageNumber - 1;
            const totalPages = this.openSeaDragon.tileSources ?
                this.openSeaDragon.tileSources.length : this.openSeaDragon.world.getItemCount();
            if(targetIndex >= 0 && targetIndex < totalPages) {
                this.openSeaDragon.goToPage(targetIndex);
            }
        }
    }
    
    getCurrentPage() {
        // OpenSeadragon's currentPage is 0-based; expose it as 1-based
        return this.openSeaDragon ? this.openSeaDragon.currentPage() + 1 : 0;
    }
    
    getTotalPages() {
        if (!this.openSeaDragon) return 0;
        // In sequence mode OpenSeadragon keeps only the current image in `world`
        // (getItemCount() === 1), so the authoritative total is the number of
        // configured tile sources. Mirror the bound check used by goToPage().
        return this.openSeaDragon.tileSources ?
            this.openSeaDragon.tileSources.length : this.openSeaDragon.world.getItemCount();
    }
    
    // Home/reset view
    home() {
        if(this.openSeaDragon) {
            this.openSeaDragon.viewport.goHome();
        }
    }
    
    // Full screen methods
    //
    // Use the standard Fullscreen API on the component host element rather than
    // OpenSeadragon's built-in full-page mode. OSD's full-page reparents the
    // viewer to <body> and hides sibling nodes, which blanks the page when the
    // viewer lives inside a shadow DOM. Going fullscreen on the host keeps the
    // whole component (viewer + overlays) intact and correctly styled.
    setFullScreen(fullScreen) {
        if (fullScreen) {
            const request = this.requestFullscreen
                || this.webkitRequestFullscreen
                || this.msRequestFullscreen;
            if (request) request.call(this);
        } else if (this.isFullScreen()) {
            const exit = document.exitFullscreen
                || document.webkitExitFullscreen
                || document.msExitFullscreen;
            if (exit) exit.call(document);
        }
    }

    toggleFullScreen() {
        this.setFullScreen(!this.isFullScreen());
    }

    isFullScreen() {
        const fsElement = document.fullscreenElement
            || document.webkitFullscreenElement
            || document.msFullscreenElement;
        return fsElement === this;
    }
    
    // Rotation methods
    rotate(degrees) {
        if(this.openSeaDragon && !isNaN(degrees)) {
            this.openSeaDragon.viewport.setRotation(
                this.openSeaDragon.viewport.getRotation() + degrees
            );
        }
    }
    
    setRotation(degrees) {
        if(this.openSeaDragon && !isNaN(degrees)) {
            this.openSeaDragon.viewport.setRotation(degrees);
        }
    }
    
    getRotation() {
        return this.openSeaDragon ? this.openSeaDragon.viewport.getRotation() : 0;
    }

    // ---------------------------------------------------------------
    //  Viewport helpers (image-space)
    // ---------------------------------------------------------------

    /**
     * Returns the currently visible region of the image in image-pixel
     * coordinates, clamped to the image bounds.
     * @returns {{x:number,y:number,width:number,height:number}}
     */
    getImageViewportRect() {
        if (!this.openSeaDragon) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        const tiledImage = this.openSeaDragon.world.getItemAt(0);
        if (!tiledImage) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        const viewportBounds = this.openSeaDragon.viewport.getBounds();
        const imageBounds = tiledImage.viewportToImageRectangle(viewportBounds);
        const size = tiledImage.getContentSize();
        const x = imageBounds.x < 0 ? 0 : imageBounds.x;
        const y = imageBounds.y < 0 ? 0 : imageBounds.y;
        const width = imageBounds.width > size.x ? size.x : imageBounds.width;
        const height = imageBounds.height > size.y ? size.y : imageBounds.height;
        return { x: x, y: y, width: width, height: height };
    }

    /**
     * Fits the viewport to the given image-pixel rectangle (with constraints).
     * @param {number} x - Upper-left X in image pixels.
     * @param {number} y - Upper-left Y in image pixels.
     * @param {number} width - Width in image pixels.
     * @param {number} height - Height in image pixels.
     */
    fitImageRect(x, y, width, height) {
        if (!this.openSeaDragon) return;
        const tiledImage = this.openSeaDragon.world.getItemAt(0);
        if (!tiledImage) return;
        const rect = tiledImage.imageToViewportRectangle(
            Number(x), Number(y), Number(width), Number(height));
        // immediately=true: the animated spring does not advance in this
        // embedding, so an animated fit would never move the viewport.
        this.openSeaDragon.viewport.fitBoundsWithConstraints(rect, true);
    }

    // ---------------------------------------------------------------
    //  Overlay management (image-space)
    // ---------------------------------------------------------------

    /**
     * Adds an HTML/SVG element overlay positioned by image-pixel coordinates.
     * @param {Element} element - The overlay element.
     * @param {number} x - Upper-left X in image pixels.
     * @param {number} y - Upper-left Y in image pixels.
     * @param {number} width - Width in image pixels.
     * @param {number} height - Height in image pixels.
     */
    addImageOverlay(element, x, y, width, height) {
        if (!this.openSeaDragon) return;
        const tiledImage = this.openSeaDragon.world.getItemAt(0);
        if (!tiledImage) return;
        const rect = tiledImage.imageToViewportRectangle(
            Number(x), Number(y), Number(width), Number(height));
        this.openSeaDragon.addOverlay({ element: element, location: rect });
    }

    /**
     * Removes an overlay by its element id (no-op if it does not exist).
     * @param {string} overlayId
     */
    removeOverlay(overlayId) {
        if (!this.openSeaDragon) return;
        // OpenSeadragon's removeOverlay(string) resolves the element via
        // document.getElementById, which CANNOT see elements inside this
        // component's shadow DOM, so the overlay would never be removed
        // (e.g. hiding annotations did nothing). Resolve the element from the
        // shadow root ourselves and pass it directly; fall back to the id.
        const element = this.shadowRoot.getElementById(overlayId);
        this.openSeaDragon.removeOverlay(element || overlayId);
    }

    /**
     * Returns an overlay by id, or null if not present / viewer not ready.
     * @param {string} overlayId
     * @returns {object|null}
     */
    getOverlayById(overlayId) {
        return this.openSeaDragon ? this.openSeaDragon.getOverlayById(overlayId) : null;
    }

    // ---------------------------------------------------------------
    //  Named SVG layers (push model, rendered from layers-data)
    // ---------------------------------------------------------------

    /**
     * Removes all currently rendered layer containers and resets the map.
     * @private
     */
    _clearLayers() {
        const me = this;
        Object.keys(this._layerContainers).forEach(function (layerId) {
            me.removeOverlay(me._layerContainers[layerId].id);
        });
        this._layerContainers = {};
    }

    /**
     * Rebuilds every layer container from `_layersData` (current page). A
     * no-op until the OSD viewer/tiles are ready - re-invoked from the
     * 'tile-drawn'/'page' handlers so a layers-data push that arrives before
     * readiness is not silently dropped.
     * @private
     */
    _renderLayers() {
        const me = this;
        this._clearLayers();
        if (!this.openSeaDragon) return;

        Object.keys(this._layersData).forEach(function (layerId) {
            const svgString = me._layersData[layerId];
            if (!svgString) return;

            const parser = new DOMParser();
            const svg = parser.parseFromString(svgString, 'text/xml').documentElement;
            svg.id = me.id + '_' + layerId;
            const width = svg.width.baseVal.value;
            const height = svg.height.baseVal.value;
            // See addSVGOverlay history: the raw SVG's native pixel width/height
            // would render at that literal CSS pixel size regardless of the
            // container; fill the container instead, viewBox keeps the paths'
            // absolute image-pixel coordinate mapping intact.
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');

            me._layerContainers[layerId] = svg;
            me.addImageOverlay(svg, 0, 0, width, height);
        });

        this._applyLayerVisibility();
    }

    /**
     * Toggles visibility of already-rendered layer containers to match
     * `_visibleLayers`. Pure visibility flip - no rebuild, no refetch.
     * @private
     */
    _applyLayerVisibility() {
        const me = this;
        Object.keys(this._layerContainers).forEach(function (layerId) {
            me._layerContainers[layerId].style.visibility =
                me._visibleLayers.indexOf(layerId) !== -1 ? '' : 'hidden';
        });
    }

    // ---------------------------------------------------------------
    //  Zone overlays (push model, rendered from zones-data by type)
    // ---------------------------------------------------------------

    /**
     * Removes all zone overlays currently rendered in the shadow DOM and
     * resets the per-group container map.
     * @private
     */
    _clearOverlays() {
        const me = this;
        Object.keys(this._overlayContainers).forEach(function (containerId) {
            me.removeOverlay(containerId);
        });
        this._overlayContainers = {};
        this._overlayBadges = [];
        // hide any tooltip left over from the previous page's overlays
        if (this._annotTipHideTimer) { clearTimeout(this._annotTipHideTimer); this._annotTipHideTimer = null; }
        if (this._annotTipEl) this._annotTipEl.style.display = 'none';
    }

    /**
     * Lazily creates the single reusable annotation tooltip element and appends
     * it to the viewer container. The tooltip stays open while the pointer is
     * over it (so links inside it remain clickable) and hides on mouseleave.
     * @private
     */
    _ensureAnnotationTooltip() {
        const me = this;
        if (this._annotTipEl) return this._annotTipEl;
        const tip = document.createElement('div');
        tip.className = 'edirom-annotation-tip annotationTip';
        tip.style.position = 'absolute';
        tip.style.zIndex = '1000';
        tip.style.display = 'none';
        tip.style.maxWidth = '300px';
        tip.style.maxHeight = '300px';
        tip.style.overflow = 'auto';
        tip.addEventListener('mouseenter', function () {
            if (me._annotTipHideTimer) { clearTimeout(me._annotTipHideTimer); me._annotTipHideTimer = null; }
        });
        tip.addEventListener('mouseleave', function () { me._hideAnnotationTooltip(); });
        (this.viewerDiv || this.shadowRoot).appendChild(tip);
        this._annotTipEl = tip;
        return tip;
    }

    /**
     * Shows the annotation tooltip for a badge, rendering the host-supplied
     * HTML and positioning it next to the badge within the viewer container.
     * @private
     */
    _showAnnotationTooltip(badge, html) {
        if (!html) return;
        if (this._annotTipHideTimer) { clearTimeout(this._annotTipHideTimer); this._annotTipHideTimer = null; }
        const tip = this._ensureAnnotationTooltip();
        tip.innerHTML = html;
        tip.style.display = 'block';

        const host = this.viewerDiv || this.shadowRoot;
        const hostRect = host.getBoundingClientRect();
        const badgeRect = badge.getBoundingClientRect();

        // default: to the right of the badge; flip to the left if it overflows
        let left = badgeRect.right - hostRect.left + 8;
        if (left + tip.offsetWidth > host.clientWidth) {
            left = badgeRect.left - hostRect.left - tip.offsetWidth - 8;
        }
        if (left < 0) left = 4;

        let top = badgeRect.top - hostRect.top;
        if (top + tip.offsetHeight > host.clientHeight) {
            top = host.clientHeight - tip.offsetHeight - 4;
        }
        if (top < 0) top = 4;

        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
    }

    /**
     * Hides the annotation tooltip after a short grace period so the pointer
     * can travel from the badge into the tooltip without it disappearing.
     * @private
     */
    _hideAnnotationTooltip() {
        const me = this;
        if (this._annotTipHideTimer) clearTimeout(this._annotTipHideTimer);
        this._annotTipHideTimer = setTimeout(function () {
            if (me._annotTipEl) me._annotTipEl.style.display = 'none';
            me._annotTipHideTimer = null;
        }, 300);
    }

    /**
     * Whether a zone should be HIDDEN by the current `hidden-filters` set: true
     * when any of the zone's opaque filter tokens is in the hidden set. With no
     * hidden set (null / empty) nothing is hidden. This single exclusion rule
     * replaces the old per-axis category/priority matching and stays agnostic
     * of what the tokens mean.
     * @private
     */
    _zoneHiddenByFilter(tokens) {
        const hidden = this._hiddenFilters;
        if (!Array.isArray(hidden) || hidden.length === 0) return false;
        for (let i = 0; i < tokens.length; i++) {
            if (hidden.indexOf(tokens[i]) !== -1) return true;
        }
        return false;
    }

    /**
     * Shows or hides rendered zone overlays according to the generic
     * `hidden-filters` set. Only overlays flagged `filterable` (i.e. those that
     * carry filter tokens, such as annotations) are affected; non-filterable
     * overlays (e.g. measure labels) are always shown. A container is made
     * visible only when it still has at least one visible child. Re-applied
     * after every render so the filter persists across pages.
     *
     * NOTE: container visibility toggles `visibility`, not `display`, because
     * OpenSeadragon re-applies `display:block` to every overlay on each redraw
     * (which would override a `display:none` hide) but never touches
     * `visibility`.
     * @private
     */
    _applyOverlayVisibility() {
        const me = this;
        const containers = this._overlayContainers;
        const containerHasVisible = {};

        (this._overlayBadges || []).forEach(function (rec) {
            const visible = !rec.filterable || !me._zoneHiddenByFilter(rec.filters);
            rec.element.style.display = visible ? '' : 'none';
            if (visible) containerHasVisible[rec.containerId] = true;
        });

        Object.keys(containers).forEach(function (containerId) {
            containers[containerId].style.visibility =
                containerHasVisible[containerId] ? '' : 'hidden';
        });
    }

    /**
     * Notifies the host that the active filter changed, so it can keep its
     * filter menu checkboxes in sync. Fired whenever the `hidden-filters`
     * attribute changes (including when set externally, e.g. via DevTools).
     * The detail carries the current hidden-token array (null / [] = nothing
     * hidden / show all).
     * @private
     */
    _emitFilterChanged() {
        this.dispatchEvent(new CustomEvent('filter-changed', {
            detail: {
                hiddenFilters: this._hiddenFilters
            }
        }));
    }

    /**
     * Renders zone overlays from `this._zonesData` for the current page. Only
     * zones whose `type` is in `this._visibleTypes`, that carry image-pixel
     * coordinates and that belong to the current page are drawn. Zones sharing
     * a `group` (e.g. several annotations on the same measure) share one
     * container so their inner elements stack.
     *
     * The component is format-agnostic: the host supplies the CSS classes
     * (`containerClass` / `innerClass`), optional `label` text, `tooltip` HTML
     * and `fn` (host click action) per zone. Each inner element fires generic
     * `zone-click` / `zone-mouseenter` / `zone-mouseleave` CustomEvents the
     * host listens to; the component renders the hover tooltip itself.
     * @private
     */
    _renderOverlays() {
        const me = this;
        this._clearOverlays();
        if (!this.openSeaDragon) return;

        const visibleTypes = Array.isArray(this._visibleTypes) ? this._visibleTypes : [];
        if (visibleTypes.length === 0) return;

        const currentPage = this.openSeaDragon.currentPage() + 1; // 1-based

        Object.keys(this._zonesData).forEach(function (zoneKey) {
            const zone = me._zonesData[zoneKey];
            if (!zone || typeof zone !== 'object') return;

            // Only render zones of a currently visible type.
            if (visibleTypes.indexOf(zone.type) === -1) return;

            // Skip zones without image-pixel coordinates (e.g. movement targets
            // that only carry a page for navigation).
            if (zone.ulx == null || zone.uly == null ||
                zone.lrx == null || zone.lry == null) return;

            // Only render zones that belong to the current page (when a page is
            // given). Zones without a page are treated as page-agnostic.
            if (zone.page != null && parseInt(zone.page) !== currentPage) return;

            const x = Number(zone.ulx);
            const y = Number(zone.uly);
            const width = Number(zone.lrx) - Number(zone.ulx);
            const height = Number(zone.lry) - Number(zone.uly);

            // Zones sharing a group stack inside one container; ungrouped zones
            // get their own container keyed by the zone key.
            const containerId = zone.group || zoneKey;
            let container = me._overlayContainers[containerId];
            if (!container) {
                container = document.createElement('div');
                container.id = containerId;
                container.className = zone.containerClass || ('edirom-zone edirom-zone-' + zone.type);
                if (zone.dataId != null) container.dataset.ediromAnnotId = zone.dataId;
                me._overlayContainers[containerId] = container;
                me.addImageOverlay(container, x, y, width, height);
            }

            const inner = document.createElement('div');
            inner.id = containerId + '_' + zoneKey;
            inner.className = (zone.innerClass || 'edirom-zone-inner').replace(/\s+/g, ' ').trim();
            if (zone.label != null && zone.label !== '') inner.textContent = zone.label;
            if (zone.title) inner.title = zone.title;
            if (zone.dataId != null) inner.setAttribute('data-edirom-annot-id', zone.dataId);
            container.appendChild(inner);

            // Track the inner element so the generic filter can toggle it.
            // `filters` are the zone's opaque filter tokens; `filterable` is
            // true only for zones carrying at least one token (e.g. annotations),
            // so non-filterable zones (measure labels) always stay visible.
            const filterTokens = String(zone.filters || '').split(/\s+/).filter(Boolean);
            me._overlayBadges.push({
                element: inner,
                containerId: containerId,
                filters: filterTokens,
                filterable: filterTokens.length > 0
            });

            const detail = {
                type: zone.type,
                key: zoneKey,
                id: zone.dataId,
                fn: zone.fn || '',
                title: zone.title || '',
                element: inner
            };
            const tooltip = zone.tooltip || '';

            // OpenSeadragon's MouseTracker captures pointer events on its
            // container; stop them on the inner element so the native click
            // fires and the host receives the event instead of OSD panning.
            inner.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
            inner.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
            inner.addEventListener('click', function (ev) {
                ev.stopPropagation();
                ev.preventDefault();
                me.dispatchEvent(new CustomEvent('zone-click', { detail: detail }));
            });
            inner.addEventListener('mouseenter', function () {
                if (tooltip) me._showAnnotationTooltip(inner, tooltip);
                me.dispatchEvent(new CustomEvent('zone-mouseenter', { detail: detail }));
            });
            inner.addEventListener('mouseleave', function () {
                if (tooltip) me._hideAnnotationTooltip();
                me.dispatchEvent(new CustomEvent('zone-mouseleave', { detail: detail }));
            });
        });

        // honour the current category/priority filter for the freshly built overlays
        this._applyOverlayVisibility();
    }

    // ---------------------------------------------------------------
    //  Zone / measure / movement navigation
    // ---------------------------------------------------------------

    /**
     * Navigates the viewer to the zone identified by `zoneKey` in `_zonesData`.
     * Handles same-page transitions (smooth) and cross-page transitions
     * (page change + deferred zone application).
     * @param {string} zoneKey - Key of the zone in the zones-data map.
     */
    _applyZoneByKey(zoneKey) {
        const zone = this._zonesData[zoneKey];
        if (!zone) {
            console.warn(`edirom-image-viewer: zone "${zoneKey}" not found in zones-data.`);
            return;
        }
        this._currentZoneKey = zoneKey;
        this._navigateToRegion(zone, zoneKey, 'zone-changed');
    }

    /**
     * Shared page-aware navigation used by zone jumps. Measures and movements
     * are pushed as ordinary zone entries by the host, so this is the single
     * page-aware region navigator.
     * Handles same-page transitions (apply region directly) and cross-page
     * transitions (change page, then apply the region once tiles are loaded).
     * @param {Object} region - Region with a 1-based `page` and optional
     *     `ulx, uly, lrx, lry` pixel coordinates.
     * @param {string} key - The lookup key, echoed back in the change event.
     * @param {string} eventName - CustomEvent name fired once navigation lands.
     */
    _navigateToRegion(region, key, eventName) {
        if (!this.openSeaDragon) {
            // Viewer not ready yet — initializeViewer re-applies the active zone.
            return;
        }

        const targetPage = parseInt(region.page) - 1; // 1-based → 0-based
        const currentPage = this.openSeaDragon.currentPage();

        if (isNaN(targetPage) || targetPage === currentPage) {
            // Same page (or no page given): apply region directly
            this._applyZone(region);
            this._fireRegionChanged(eventName, key, region);
        } else {
            // Different page: defer region until the new page's tiles are loaded
            this._pendingZoneAfterPageChange = { zoneKey: key, zone: region, eventName };
            this.openSeaDragon.goToPage(targetPage);
        }
    }

    /**
     * Zooms/pans the viewport to the zone coordinates, or resets to home if
     * no coordinates are present. Uses OSD's spring animation for smooth transitions.
     * @param {Object} zone - The zone object with optional ulx, uly, lrx, lry.
     */
    _applyZone(zone) {
        if (!this.openSeaDragon) return;

        const hasZone = zone.ulx != null && zone.uly != null &&
            zone.lrx != null && zone.lry != null;

        if (!hasZone) {
            this.openSeaDragon.viewport.goHome();
            return;
        }

        // Convert pixel coordinates to viewport coordinates via the current TiledImage
        const tiledImage = this.openSeaDragon.world.getItemAt(0);
        if (!tiledImage) {
            console.warn('edirom-image-viewer: no TiledImage available for zone conversion.');
            this.openSeaDragon.viewport.goHome();
            return;
        }

        const rect = tiledImage.imageToViewportRectangle(
            Number(zone.ulx),
            Number(zone.uly),
            Number(zone.lrx) - Number(zone.ulx),
            Number(zone.lry) - Number(zone.uly)
        );
        // Smooth spring animation into the zone 
        this.openSeaDragon.viewport.fitBounds(rect);
    }

    /**
     * Dispatches the `zone-changed` custom event.
     * @param {string} zoneKey - The key of the zone that was navigated to.
     * @param {Object} zone - The zone object that was navigated to.
     */
    _fireZoneChanged(zoneKey, zone) {
        this.dispatchEvent(new CustomEvent('zone-changed', {
            detail: { zoneKey, zone },
            bubbles: true
        }));
    }

    /**
     * Dispatches a region-navigation custom event (currently `zone-changed`).
     * @param {string} eventName - The event name to dispatch.
     * @param {string} key - The lookup key that was navigated to.
     * @param {Object} region - The region object that was navigated to.
     */
    _fireRegionChanged(eventName, key, region) {
        this.dispatchEvent(new CustomEvent(eventName, {
            detail: { key, zoneKey: key, region, zone: region },
            bubbles: true
        }));
    }

    /**
     * Dispatches the `page-changed` custom event.
     * @param {number} pageNumber - The 1-based page number that was navigated to.
     */
    _firePageChanged(pageNumber) {
        this.dispatchEvent(new CustomEvent('page-changed', {
            detail: { pageNumber },
            bubbles: true
        }));
    }

    /**
     * Dispatches a `total-pages-changed` event whenever the set of tile sources
     * changes, so host pagination (page spinner bounds, "page X of Y" labels)
     * can resync to the new total.
     * @param {number} totalPages - The new total number of pages (tile sources).
     */
    _fireTotalPagesChanged(totalPages) {
        this.dispatchEvent(new CustomEvent('total-pages-changed', {
            detail: { totalPages },
            bubbles: true
        }));
    }
}

customElements.define('edirom-image-viewer', EdiromOpenseadragon);