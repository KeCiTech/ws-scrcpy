import { ToolBoxElement } from './ToolBoxElement';

export class ToolBox {
    private readonly holder: HTMLElement;
    private isDragging = false;
    private currentX = 0;
    private currentY = 0;
    private initialX = 0;
    private initialY = 0;
    private xOffset = 0;
    private yOffset = 0;

    constructor(list: ToolBoxElement<any>[]) {
        this.holder = document.createElement('div');
        this.holder.classList.add('control-buttons-list', 'control-wrapper');

        list.forEach((item) => {
            item.getAllElements().forEach((el) => {
                this.holder.appendChild(el);
                if (el instanceof HTMLElement && el.getAttribute('title') === 'More') {
                    el.addEventListener('click', () => this.toggleMoreBox());
                }
            });
        });

        this.initDragHandlers();
        this.initMoreBoxHandlers();
    }

    private isNarrowScreen(): boolean {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const aspectRatio = 0.6;
        return viewportWidth / viewportHeight < aspectRatio;
    }

    private initDragHandlers(): void {
        this.holder.addEventListener('mousedown', (e: MouseEvent) => {
            this.isDragging = true;
            this.initialX = e.clientX - this.xOffset;
            this.initialY = e.clientY - this.yOffset;
        });

        document.addEventListener('mousemove', (e: MouseEvent) => {
            if (this.isDragging) {
                e.preventDefault();
                this.currentX = e.clientX - this.initialX;
                this.currentY = e.clientY - this.initialY;
                this.xOffset = this.currentX;
                this.yOffset = this.currentY;
                if (this.isNarrowScreen()) {
                    // In narrow screen mode, maintain 50% offset while allowing horizontal dragging
                    this.holder.style.transform = `translate(calc(-50% + ${this.currentX}px), ${this.currentY}px)`;
                } else {
                    this.holder.style.transform = `translate(${this.currentX}px, ${this.currentY}px)`;
                }

                // Update more-box position when dragging
                const moreBox = document.querySelector('.more-box') as HTMLElement;
                if (moreBox && moreBox.classList.contains('show')) {
                    this.setMoreBoxPosition(moreBox);
                }
            }
        });

        document.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        // Add mouseleave event handler to prevent losing track during fast dragging
        document.addEventListener('mouseleave', () => {
            this.isDragging = false;
        });
    }

    private toggleMoreBox(): void {
        const moreBox = document.querySelector('.more-box') as HTMLElement;
        if (!moreBox) return;

        const isVisible = moreBox.classList.contains('show');

        if (!isVisible) {
            this.holder.classList.add('show-all');
            moreBox.classList.add('show');
            this.setMoreBoxPosition(moreBox);
        } else {
            this.holder.classList.remove('show-all');
            moreBox.classList.remove('show', 'position-left', 'position-right');
        }
    }

    private initMoreBoxHandlers(): void {
        window.addEventListener('resize', () => {
            const moreBox = document.querySelector('.more-box') as HTMLElement;
            if (moreBox && moreBox.classList.contains('show')) {
                this.setMoreBoxPosition(moreBox);
            }
        });
    }

    private setMoreBoxPosition(moreBox: HTMLElement): void {
        const holderRect = this.holder.getBoundingClientRect();
        const windowWidth = window.innerWidth;

        moreBox.classList.remove('position-left', 'position-right');

        const moreBoxWidth = moreBox.offsetWidth || 200; // Default width
        const rightSpace = windowWidth - holderRect.right;

        // Calculate position
        if (rightSpace >= moreBoxWidth + 10) {
            // Right side has enough space
            moreBox.style.left = `${holderRect.right + 5}px`;
            moreBox.classList.add('position-right');
        } else {
            // Not enough space on right, show on left side
            // Ensure more-box doesn't go beyond left boundary
            const leftPosition = Math.max(holderRect.left - moreBoxWidth - 5, 10);
            moreBox.style.left = `${leftPosition}px`;
            moreBox.classList.add('position-left');
        }

        // Set vertical position, avoid exceeding viewport top
        const topPosition = Math.max(holderRect.top, 10);
        moreBox.style.top = `${topPosition}px`;

        // Ensure not exceeding viewport bottom
        const viewportHeight = window.innerHeight;
        const moreBoxHeight = moreBox.offsetHeight;
        if (topPosition + moreBoxHeight > viewportHeight) {
            moreBox.style.top = `${viewportHeight - moreBoxHeight - 10}px`;
        }
    }

    public getHolderElement(): HTMLElement {
        return this.holder;
    }
}
