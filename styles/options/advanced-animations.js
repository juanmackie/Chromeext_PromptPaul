/**
 * MD3 Advanced Animations - JavaScript Controller
 *
 * This file provides JavaScript functionality for the advanced animation systems,
 * particularly handling intersection observer integration for scroll-triggered animations.
 *
 * Features:
 * - Intersection Observer setup for scroll-triggered animations
 * - Stagger animation coordination and timing
 * - Performance monitoring for animations
 * - Accessibility support for reduced motion preferences
 * - Animation cleanup and memory management
 */

class MD3AdvancedAnimations {
  constructor() {
    this.observers = new Map();
    this.animationQueue = new Set();
    this.performanceMonitor = new Map();
    this.isInitialized = false;

    this.init();
  }

  /**
   * Initialize the advanced animations system
   */
  init() {
    if (this.isInitialized) return;

    // Check for reduced motion preference
    this.respectsReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Set up intersection observers
    this.setupScrollObserver();
    this.setupPerformanceObserver();

    // Set up resize observer for responsive adjustments
    this.setupResizeObserver();

    // Add CSS custom property support for scroll-based animations
    this.addScrollProperties();

    this.isInitialized = true;
    console.log('MD3 Advanced Animations initialized');
  }

  /**
   * Set up intersection observer for scroll-triggered animations
   */
  setupScrollObserver() {
    if (!('IntersectionObserver' in window)) {
      console.warn('IntersectionObserver not supported, scroll animations disabled');
      return;
    }

    const observerOptions = {
      threshold: parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--md3-scroll-threshold')) || 0.1,
      rootMargin: getComputedStyle(document.documentElement)
        .getPropertyValue('--md3-scroll-root-margin') || '50px'
    };

    this.scrollObserver = new IntersectionObserver(
      this.handleScrollAnimation.bind(this),
      observerOptions
    );
  }

  /**
   * Handle scroll-triggered animation events
   */
  handleScrollAnimation(entries) {
    entries.forEach(entry => {
      const element = entry.target;

      if (entry.isIntersecting) {
        this.triggerScrollAnimation(element);
      } else {
        this.resetScrollAnimation(element);
      }
    });
  }

  /**
   * Trigger scroll-based animations
   */
  triggerScrollAnimation(element) {
    if (this.respectsReducedMotion) return;

    // Add animation classes
    element.classList.add('animate-in', 'revealed');

    // Handle stagger animations
    if (element.classList.contains('md3-stagger-container')) {
      this.handleStaggerAnimation(element);
    }

    // Handle parallax effects
    if (element.classList.contains('md3-parallax-container')) {
      this.handleParallaxAnimation(element);
    }

    // Performance monitoring
    this.monitorPerformance(element, 'scroll-trigger');
  }

  /**
   * Reset scroll animations when element leaves viewport
   */
  resetScrollAnimation(element) {
    // Only reset if configured to do so
    if (element.dataset.scrollReset === 'true') {
      element.classList.remove('animate-in', 'revealed');
    }
  }

  /**
   * Handle stagger animations for containers
   */
  handleStaggerAnimation(container) {
    const children = Array.from(container.children);
    const staggerDelay = parseInt(getComputedStyle(container)
      .getPropertyValue('--md3-stagger-increment')) || 50;

    children.forEach((child, index) => {
      // Set custom properties for animation delay calculation
      child.style.setProperty('--data-stagger-index', (index + 1).toString());

      // Calculate total items for reverse stagger
      if (container.classList.contains('md3-stagger-reverse')) {
        child.style.setProperty('--data-total-items', children.length.toString());
      }

      // Add random delays for random stagger
      if (container.classList.contains('md3-stagger-random')) {
        const randomDelay = Math.random() * staggerDelay * 3;
        child.style.setProperty('--data-random-delay', randomDelay.toString());
      }

      // Trigger animation with calculated delay
      setTimeout(() => {
        child.classList.add('animate-in');
      }, index * staggerDelay);
    });
  }

  /**
   * Handle parallax animation effects
   */
  handleParallaxAnimation(container) {
    const layers = container.querySelectorAll('.md3-parallax-layer');

    layers.forEach(layer => {
      // Set up scroll-based transform updates
      const updateParallax = () => {
        if (this.respectsReducedMotion) return;

        const rect = container.getBoundingClientRect();
        const scrollY = window.pageYOffset;
        const containerTop = rect.top + scrollY;
        const containerHeight = rect.height;
        const windowHeight = window.innerHeight;

        // Calculate scroll progress through container
        const progress = Math.max(0, Math.min(1,
          (scrollY - containerTop + windowHeight) / (containerHeight + windowHeight)
        ));

        // Apply parallax transform
        const speed = this.getParallaxSpeed(layer);
        const offset = (progress - 0.5) * speed * 100;

        layer.style.transform = `translateY(${offset}px)`;
        layer.style.setProperty('--md3-scroll-y', scrollY.toString());
      };

      // Throttle scroll updates
      let ticking = false;
      const throttledUpdate = () => {
        if (!ticking) {
          requestAnimationFrame(() => {
            updateParallax();
            ticking = false;
          });
          ticking = true;
        }
      };

      window.addEventListener('scroll', throttledUpdate, { passive: true });
    });
  }

  /**
   * Get parallax speed multiplier for layer
   */
  getParallaxSpeed(layer) {
    if (layer.classList.contains('md3-parallax-slow')) return 0.3;
    if (layer.classList.contains('md3-parallax-medium')) return 0.6;
    if (layer.classList.contains('md3-parallax-fast')) return 0.9;
    return 0.5;
  }

  /**
   * Set up performance observer for animation monitoring
   */
  setupPerformanceObserver() {
    if (!('PerformanceObserver' in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'measure' && entry.name.startsWith('md3-animation-')) {
            this.logPerformance(entry.name, entry.duration);
          }
        }
      });

      observer.observe({ entryTypes: ['measure'] });
    } catch (e) {
      console.warn('PerformanceObserver not fully supported');
    }
  }

  /**
   * Monitor animation performance
   */
  monitorPerformance(element, animationType) {
    if (!('performance' in window)) return;

    const startTime = performance.now();
    const animationId = `md3-animation-${animationType}-${Date.now()}`;

    // Mark animation start
    performance.mark(`${animationId}-start`);

    // Monitor animation completion
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' &&
            mutation.attributeName === 'class' &&
            element.classList.contains('animation-complete')) {

          performance.mark(`${animationId}-end`);
          performance.measure(animationId, `${animationId}-start`, `${animationId}-end`);

          observer.disconnect();
        }
      });
    });

    observer.observe(element, { attributes: true, attributeFilter: ['class'] });
  }

  /**
   * Log performance metrics
   */
  logPerformance(animationId, duration) {
    this.performanceMonitor.set(animationId, {
      duration,
      timestamp: Date.now()
    });

    // Warn about slow animations
    if (duration > 100) {
      console.warn(`Slow animation detected: ${animationId} took ${duration}ms`);
    }
  }

  /**
   * Set up resize observer for responsive adjustments
   */
  setupResizeObserver() {
    if (!('ResizeObserver' in window)) return;

    this.resizeObserver = new ResizeObserver(entries => {
      entries.forEach(entry => {
        // Recalculate stagger animations on resize
        if (entry.target.classList.contains('md3-stagger-container')) {
          this.recalculateStaggerAnimation(entry.target);
        }
      });
    });
  }

  /**
   * Recalculate stagger animations after resize
   */
  recalculateStaggerAnimation(container) {
    const children = Array.from(container.children);
    children.forEach((child, index) => {
      child.style.setProperty('--data-stagger-index', (index + 1).toString());
    });
  }

  /**
   * Add CSS custom properties for scroll-based animations
   */
  addScrollProperties() {
    // Add scroll position properties
    const updateScrollProperties = () => {
      const scrollY = window.pageYOffset;
      const scrollX = window.pageXOffset;

      document.documentElement.style.setProperty('--md3-scroll-y', `${scrollY}px`);
      document.documentElement.style.setProperty('--md3-scroll-x', `${scrollX}px`);
    };

    // Throttle scroll updates
    let ticking = false;
    const throttledUpdate = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          updateScrollProperties();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', throttledUpdate, { passive: true });
    updateScrollProperties(); // Initial call
  }

  /**
   * Register elements for scroll-triggered animations
   */
  observe(element) {
    if (!this.scrollObserver) return;

    // Add animation-ready class
    element.classList.add('md3-animation-ready');

    // Observe element
    this.scrollObserver.observe(element);
  }

  /**
   * Register container for resize observation
   */
  observeResize(element) {
    if (!this.resizeObserver) return;

    this.resizeObserver.observe(element);
  }

  /**
   * Unregister element from observations
   */
  unobserve(element) {
    if (this.scrollObserver) {
      this.scrollObserver.unobserve(element);
    }

    if (this.resizeObserver) {
      this.resizeObserver.unobserve(element);
    }

    // Clean up animation classes
    element.classList.remove('md3-animation-ready', 'animate-in', 'revealed');
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    return {
      totalAnimations: this.performanceMonitor.size,
      averageDuration: Array.from(this.performanceMonitor.values())
        .reduce((sum, entry) => sum + entry.duration, 0) / this.performanceMonitor.size || 0,
      slowAnimations: Array.from(this.performanceMonitor.entries())
        .filter(([_, entry]) => entry.duration > 100).length
    };
  }

  /**
   * Clean up all observers and references
   */
  destroy() {
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    this.observers.clear();
    this.animationQueue.clear();
    this.performanceMonitor.clear();

    this.isInitialized = false;
    console.log('MD3 Advanced Animations destroyed');
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.MD3AdvancedAnimations = new MD3AdvancedAnimations();
  });
} else {
  window.MD3AdvancedAnimations = new MD3AdvancedAnimations();
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MD3AdvancedAnimations;
}