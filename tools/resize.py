from PIL import Image

def resize_icon(input_path, output_path, size=(128, 128)):
    img = Image.open(input_path)
    img.thumbnail(size, Image.Resampling.LANCZOS)
    
    # Create a new image with transparent background
    new_img = Image.new("RGBA", size, (0, 0, 0, 0))
    
    # Paste the original image onto the center of the new image
    paste_x = (size[0] - img.width) // 2
    paste_y = (size[1] - img.height) // 2
    new_img.paste(img, (paste_x, paste_y))
    
    new_img.save(output_path, "PNG")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Crea un icono PNG centrado de 128 x 128.")
    parser.add_argument("input_path")
    parser.add_argument("output_path")
    args = parser.parse_args()
    resize_icon(args.input_path, args.output_path)
